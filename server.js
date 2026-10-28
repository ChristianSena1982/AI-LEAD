const express = require('express'); 
const cors = require('cors');
const Database = require('better-sqlite3');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Inizializza il Database SQLite locale (file leads.db)
const db = new Database('leads.db');

// Crea la tabella se non esiste
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
    status TEXT DEFAULT 'da_chiamare',
    outcomeNotes TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Inizializzazione Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ENDPOINT 1: Trova il prossimo contatto escludendo quelli già presenti nel DB
app.post('/api/next-lead', async (req, res) => {
  try {
    const { city, setterName } = req.body;

    if (!city) {
      return res.status(400).json({ error: 'Specifica una città o provincia.' });
    }

    // Recupera i contatti già salvati per la città indicata per non ripeterli
    const stmtExisting = db.prepare('SELECT name, phone FROM contacts WHERE LOWER(city) = LOWER(?)');
    const existingContacts = stmtExisting.all(city);
    const existingList = existingContacts.map(c => `${c.name} (${c.phone})`).join(', ');

    const prompt = `
Sei un assistente B2B per un team di vendita. Trova un reale e verificato studio dentistico/dentista situato a/in "${city}".

IMPORTANTE - ESCLUSIONI DA NON RIPETERE:
Non restituire NESSUNO di questi studi già contattati:
[${existingList || 'Nessuno finora'}]

ISTRUZIONI DI ESTRAZIONE DATI:
1. Trova uno studio dentistico reale ed esistente a ${city}.
2. Per ogni campo, se il dato NON è certo, NON esiste o NON è verificato, scrivi tassativamente "da chiedere":
   - Nome studio
   - Telefono
   - WhatsApp
   - Sito web
   - Email

Rispondi ESCLUSIVAMENTE in formato JSON valido senza testo o blocchi markdown extra:
{
  "name": "Nome Studio",
  "phone": "Telefono o 'da chiedere'",
  "whatsapp": "WhatsApp o 'da chiedere'",
  "website": "URL o 'da chiedere'",
  "email": "Email o 'da chiedere'"
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }] // Google Search Grounding per trovare dati reali aggiornati
      }
    });

    const responseText = response.text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Impossibile estrarre i dati. Riprova.' });
    }

    const leadData = JSON.parse(jsonMatch[0]);

    // Verifica se per caso esiste già
    const checkStmt = db.prepare('SELECT * FROM contacts WHERE LOWER(name) = LOWER(?) AND LOWER(city) = LOWER(?)');
    const exists = checkStmt.get(leadData.name, city);

    if (exists) {
      return res.json({ lead: exists });
    }

    // Salva il contatto nel database SQLite locale condiviso
    const insertStmt = db.prepare(`
      INSERT INTO contacts (setterName, city, name, phone, whatsapp, website, email, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'da_chiamare')
    `);

    const result = insertStmt.run(
      setterName || 'Anonimo',
      city,
      leadData.name,
      leadData.phone,
      leadData.whatsapp,
      leadData.website,
      leadData.email
    );

    const getNewLead = db.prepare('SELECT * FROM contacts WHERE id = ?');
    const newLead = getNewLead.get(result.lastInsertRowid);

    res.json({ lead: newLead });

  } catch (error) {
    console.error('Errore API:', error);
    res.status(500).json({ error: 'Errore durante la ricerca del contatto.' });
  }
});

// ENDPOINT 2: Registra esito della chiamata
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
