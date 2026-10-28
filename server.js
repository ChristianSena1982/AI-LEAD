const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Inizializza l'SDK ufficiale di Google Gen AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

// ENDPOINT 1: Trova il prossimo contatto tramite SDK ufficiale Gemini
app.post('/api/next-lead', async (req, res) => {
  try {
    const { city, setterName } = req.body;

    if (!city) {
      return res.status(400).json({ error: 'Specifica una città o provincia.' });
    }

    // Recupera i contatti già salvati per escluderli
    const stmtExisting = db.prepare('SELECT name FROM contacts WHERE LOWER(city) = LOWER(?)');
    const existingContacts = stmtExisting.all(city);
    const existingList = existingContacts.map(c => c.name).filter(n => n !== 'da chiedere');

    const systemInstruction = `Sei un assistente AI B2B specializzato nel settore degli studi dentistici e odontoiatrici.
Devi estrarre I DATI REALI di UN SINGOLO studio dentistico operativo nella città o provincia richiesta.

CAMPI RICHIESTI:
- name: Nome esatto dello studio/dentista
- phone: Numero di telefono fisso o principale
- whatsapp: Numero mobile WhatsApp (se verificato) oppure "da chiedere"
- website: URL del sito web commerciale o "da chiedere"
- email: Indirizzo email pubblico o "da chiedere"
- address: Indirizzo (via e civico) o "da chiedere"

REGOLE TASSATIVE:
1. Per qualsiasi dato mancante, incerto o non verificato sul web, imposta TASSATIVAMENTE la stringa "da chiedere".
2. NON inventare mai numeri di telefono, email o URL.
3. Restituisci ESCLUSIVAMENTE un oggetto JSON valido.`;

    const prompt = `Trova 1 studio dentistico a "${city}". 
ESCLUDI assolutamente i seguenti studi già contattati: ${JSON.stringify(existingList.slice(-40))}.`;

    // Chiamata pulita tramite l'SDK ufficiale di Google con Grounding Google Search attivo
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        tools: [{ googleSearch: {} }],
        responseMimeType: 'application/json'
      }
    });

    const responseText = response.text.trim();
    const leadData = JSON.parse(responseText);

    // Salva nel database SQLite con stato iniziale "In Attesa"
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
    console.error('Errore API Gemini:', error);
    res.status(500).json({ error: 'Errore durante la ricerca del contatto con l\'AI.' });
  }
});

// ENDPOINT 2: Ottieni tutti i contatti per il DB Condiviso
app.get('/api/contacts', (req, res) => {
  try {
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY id DESC').all();
    res.json({ contacts });
  } catch (error) {
    res.status(500).json({ error: 'Errore lettura database.' });
  }
});

// ENDPOINT 3: Registra esito chiamata
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
