const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Inizializza il Database SQLite locale
const db = new Database('leads.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setterName TEXT,
    city TEXT,
    name TEXT,
    phone TEXT,
    whatsapp TEXT,
    website TEXT,
    email TEXT,
    address TEXT,
    status TEXT DEFAULT 'In Attesa',
    outcomeNotes TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Modelli in ordine di velocità di risposta
const MODELS = ['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-3.8-flash'];

// Funzione ultra-veloce per interrogare Gemini con timeout a 5 secondi e fallback automatico
async function fetchGeminiFast(apiKey, prompt, systemInstruction) {
  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000); // Max 5 secondi per tentativo

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { responseMimeType: "application/json" }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timer);
      const data = await res.json();

      if (!data.error && data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
        return data; // Trovato al primo colpo!
      }
    } catch (err) {
      clearTimeout(timer);
      // Se va in timeout o errore, passa immediatamente al modello successivo
    }
  }
  throw new Error("Tutti i server dell'AI sono momentaneamente occupati. Riprova tra un istante.");
}

// ENDPOINT 1: Ricerca rapida lead
app.post('/api/next-lead', async (req, res) => {
  try {
    const { city, setterName } = req.body;

    if (!city) {
      return res.status(400).json({ error: 'Specifica una città o provincia.' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Chiave API Gemini non configurata su Render.' });
    }

    // Esclusione contatti già presenti nel DB
    const stmtExisting = db.prepare('SELECT name FROM contacts WHERE LOWER(city) = LOWER(?)');
    const existingContacts = stmtExisting.all(city);
    const existingList = existingContacts.map(c => c.name).filter(n => n !== 'da chiedere');

    const systemInstruction = `Sei un assistente AI B2B specializzato nel settore degli studi dentistici e odontoiatrici.
Devi estrarre I DATI REALI di UN SINGOLO studio dentistico operativo nella città o provincia richiesta.

CAMPI RICHIESTI:
- name: Nome esatto dello studio/dentista
- phone: Numero di telefono fisso o principale
- whatsapp: Numero mobile WhatsApp oppure "da chiedere"
- website: URL del sito web commerciale oppure "da chiedere"
- email: Indirizzo email pubblico oppure "da chiedere"
- address: Indirizzo (via e civico) o "da chiedere"

REGOLE TASSATIVE:
1. Per qualsiasi dato mancante, imposta TASSATIVAMENTE la stringa "da chiedere".
2. NON inventare mai numeri di telefono, email o URL.
3. Restituisci ESCLUSIVAMENTE un oggetto JSON valido.`;

    const prompt = `Trova 1 studio dentistico a "${city}". 
ESCLUDI assolutamente i seguenti studi già contattati: ${JSON.stringify(existingList.slice(-40))}.`;

    const geminiData = await fetchGeminiFast(GEMINI_API_KEY, prompt, systemInstruction);
    const responseText = geminiData.candidates[0].content.parts[0].text.trim();
    const leadData = JSON.parse(responseText);

    // Salvataggio DB SQLite
    const insertStmt = db.prepare(`
      INSERT INTO contacts (setterName, city, name, phone, whatsapp, website, email, address, status, outcomeNotes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'In Attesa', '')
    `);

    const result = insertStmt.run(
      setterName || 'Marco (Setter 1)',
      city,
      leadData.name || 'da chiedere',
      leadData.phone || 'da chiedere',
      leadData.whatsapp || 'da chiedere',
      leadData.website || 'da chiedere',
      leadData.email || 'da chiedere',
      leadData.address || 'da chiedere'
    );

    const getNewLead = db.prepare('SELECT * FROM contacts WHERE id = ?');
    const newLead = getNewLead.get(result.lastInsertRowid);

    res.json({ lead: newLead });

  } catch (error) {
    console.error('Errore API:', error);
    res.status(500).json({ error: error.message || 'Errore durante la ricerca del contatto.' });
  }
});

// ENDPOINT 2: DB Condiviso
app.get('/api/contacts', (req, res) => {
  try {
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY id DESC').all();
    res.json({ contacts });
  } catch (error) {
    res.status(500).json({ error: 'Errore lettura database.' });
  }
});

// ENDPOINT 3: Esito chiamata
app.post('/api/save-outcome', (req, res) => {
  try {
    const { contactId, status, notes } = req.body;
    const updateStmt = db.prepare('UPDATE contacts SET status = ?, outcomeNotes = ? WHERE id = ?');
    updateStmt.run(status, notes, contactId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Errore durante il salvataggio.' });
  }
});

// ENDPOINT 4: Svuota DB
app.post('/api/clear-db', (req, res) => {
  try {
    db.prepare('DELETE FROM contacts').run();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Errore pulizia database.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
