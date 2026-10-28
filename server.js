const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

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

// ENDPOINT 1: Trova il prossimo contatto reale, rigoroso e senza dati inventati
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

    // Esclude i contatti già presenti nel DB condiviso per quella città
    const stmtExisting = db.prepare('SELECT name FROM contacts WHERE LOWER(city) = LOWER(?)');
    const existingContacts = stmtExisting.all(city);
    const existingList = existingContacts.map(c => c.name).filter(n => n !== 'da chiedere');

    const systemInstruction = `Sei un assistente AI B2B specializzato nel settore degli studi dentistici.
Devi indicare UN SINGOLO studio dentistico realmente esistente nella città o provincia richiesta.

CAMPI RICHIESTI (formato JSON rigoroso):
- name: Nome esatto dello studio
- phone: Numero di telefono reale (se non sei assolutamente certo al 100%, scrivi "da chiedere")
- whatsapp: Numero mobile WhatsApp (se non disponibile, scrivi "da chiedere")
- website: URL del sito web ufficiale (se non disponibile, scrivi "da chiedere")
- email: Indirizzo email pubblico (se non disponibile, scrivi "da chiedere")
- address: Indirizzo (via e civico) della città

REGOLE TASSATIVE:
1. VIETATO INVENTARE DATI. Se un numero di telefono, un sito o un'email non sono verificati con certezza assoluta, devi scrivere tassativamente "da chiedere".
2. Restituisci ESCLUSIVAMENTE un oggetto JSON valido.`;

    const prompt = `Fornisci i dati reali di 1 studio dentistico a "${city}". 
ESCLUDI assolutamente i seguenti studi già contattati: ${JSON.stringify(existingList.slice(-40))}.`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    const geminiData = await geminiRes.json();
    
    if (geminiData.error) {
      console.error('Errore Gemini API:', geminiData.error);
      return res.status(500).json({ error: geminiData.error.message });
    }

    if (!geminiData.candidates || !geminiData.candidates[0].content) {
      return res.status(500).json({ error: 'Nessun contatto trovato per questa città.' });
    }

    const responseText = geminiData.candidates[0].content.parts[0].text.trim();
    const leadData = JSON.parse(responseText);

    // Salvataggio nel database SQLite condiviso
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
