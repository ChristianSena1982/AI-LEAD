app.post('/api/next-lead', async (req, res) => {
  try {
    const { city, setterName } = req.body;
    if (!city) return res.status(400).json({ error: 'Specifica una città o provincia.' });

    // Recupera contatti già esistenti per l'esclusione
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

    // Esegue la chiamata all'API Gemini LATO SERVER usando process.env.GEMINI_API_KEY
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }]
      })
    });

    const geminiData = await response.json();

    if (geminiData.error) {
      console.error("Errore da Google Gemini:", geminiData.error);
      return res.status(500).json({ error: geminiData.error.message });
    }

    const responseText = geminiData.candidates[0].content.parts[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Impossibile estrarre i dati dal motore AI.' });

    const leadData = JSON.parse(jsonMatch[0]);

    // Salva nel DB SQLite
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
    console.error('Errore durante la ricerca:', error);
    res.status(500).json({ error: 'Errore interno del server durante la ricerca.' });
  }
});
