# mupdf for PDF extraction despite its AGPL licence

PDF text, text positions, embedded images and page renders come from `mupdf` (npm, WASM). `pdfjs-dist` returns embedded images only as decoded pixels and needs a native canvas package for renders; mupdf returns original image bytes and exact text positions, which Image Occlusion masks use. AGPL is acceptable because this is a personal, non-commercial tool that is run locally and not offered as a network service. Revisit before distributing the app or hosting it.
