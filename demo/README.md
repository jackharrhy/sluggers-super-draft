# Local demo data

`sluggers-match.json` is the friendly match definition used by the local queue
script.

`stat-editor-v4-stock.txt` contains the 507-line stock profile used by the demo
Stat Editor. Its values were copied from the literal default matrices in
Sluggers Stat Editor v4.1 (`editorV3.py` at commit
`ab866526dcc4f430ef5dc7b1dd180f11f6a4f8ca`) with permission through active
maintainer/contributor collaboration. The seed imports the file through the
same parser used for user uploads; it is not a separate data path.

If an older local database still contains the former generated-number fixture,
reseeding preserves that published revision and adds the stock profile as the
next immutable revision.
