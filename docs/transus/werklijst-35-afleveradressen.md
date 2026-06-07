# Werklijst: 35 EDI-orders zonder vestiging-afleveradres

Per order de Transus-payload (EDIFACT met NAD+DP) downloaden uit Transus Online
(berichtdetail → "Download payload") en als .zip in de map `EDI/` zetten; daarna
`python import/edi_afleveradres_uit_archief.py --apply` draaien. Het script leest de
NAD+DP-adressen, koppelt/maakt de afleveradressen met GLN en backfillt deze orders.
Match-sleutel is de aflever-GLN, dus de bestandsnaam maakt niet uit.

## 150761 — SB MÖBEL BOSS (20 orders)
- ORD-2026-0051  klant-PO 8137098/9/00  transactie 249153048  aflever-GLN 4040052075041
- ORD-2026-0052  klant-PO 8137335/9/00  transactie 249153049  aflever-GLN 4040052005116
- ORD-2026-0053  klant-PO 8137336/9/00  transactie 249153050  aflever-GLN 4040052005437
- ORD-2026-0054  klant-PO 8137340/9/00  transactie 249153051  aflever-GLN 4040052005239
- ORD-2026-0055  klant-PO 8137344/9/00  transactie 249153052  aflever-GLN 4040052006021
- ORD-2026-0056  klant-PO 8137342/9/00  transactie 249153053  aflever-GLN 4040052005314
- ORD-2026-0057  klant-PO 8137333/9/00  transactie 249153054  aflever-GLN 4040052006052
- ORD-2026-0058  klant-PO 8137349/9/00  transactie 249153055  aflever-GLN 4040052006076
- ORD-2026-0059  klant-PO 8137331/9/00  transactie 249153056  aflever-GLN 4040052006212
- ORD-2026-0060  klant-PO 8137339/9/00  transactie 249153057  aflever-GLN 4040052006359
- ORD-2026-0061  klant-PO 8137346/9/00  transactie 249153058  aflever-GLN 4040052006298
- ORD-2026-0062  klant-PO 8137334/9/00  transactie 249153059  aflever-GLN 4040052006281
- ORD-2026-0063  klant-PO 8137347/9/00  transactie 249153060  aflever-GLN 4040052006465
- ORD-2026-0064  klant-PO 8137341/9/00  transactie 249153061  aflever-GLN 4040052006489
- ORD-2026-0065  klant-PO 8137332/9/00  transactie 249153062  aflever-GLN 4040052006526
- ORD-2026-0066  klant-PO 8137348/9/00  transactie 249153063  aflever-GLN 4040052006434
- ORD-2026-0067  klant-PO 8137343/9/00  transactie 249153064  aflever-GLN 4040052006120
- ORD-2026-0068  klant-PO 8137345/9/00  transactie 249153065  aflever-GLN 4040052006106
- ORD-2026-0069  klant-PO 8137337/9/00  transactie 249153066  aflever-GLN 4040052006564
- ORD-2026-0070  klant-PO 8137338/9/00  transactie 249153067  aflever-GLN 4040052006540

## 630859 — FUG HANDELSG. WEST MBH & CO. KG (6 orders)
- ORD-2026-0071  klant-PO 2916393/9/00  transactie 249153545  aflever-GLN 4040051007036
- ORD-2026-0072  klant-PO 2916384/9/00  transactie 249153546  aflever-GLN 4040051007074
- ORD-2026-0073  klant-PO 2916416/9/00  transactie 249153547  aflever-GLN 4040051007524
- ORD-2026-0074  klant-PO 2916381/9/00  transactie 249153548  aflever-GLN 4040051007067
- ORD-2026-0075  klant-PO 2916373/9/00  transactie 249153549  aflever-GLN 4040051007050
- ORD-2026-0076  klant-PO 2916378/9/00  transactie 249153550  aflever-GLN 4040051007043

## 630862 — FUG HANDELSG. OST MBH & CO. KG (5 orders)
- ORD-2026-0083  klant-PO 3993770/9/00  transactie 249153564  aflever-GLN 4040051001133
- ORD-2026-0084  klant-PO 3993771/9/00  transactie 249153565  aflever-GLN 4040051001218
- ORD-2026-0086  klant-PO 3993737/9/00  transactie 249153567  aflever-GLN 4040051001225
- ORD-2026-0087  klant-PO 3993742/9/00  transactie 249153568  aflever-GLN 4040051001171
- ORD-2026-0088  klant-PO 3993785/9/00  transactie 249153569  aflever-GLN 4040051001232

## 600556 — BDSK HANDELS GMBH & CO. KG @ (2 orders)
- ORD-2026-0022  klant-PO 8NMC8  transactie 249145329  aflever-GLN 9007019013787
- ORD-2026-0023  klant-PO 8NMBY  transactie 249145330  aflever-GLN 9007019020976

## 630861 — FUG HANDELSG. MITTE MBH & CO. KG (2 orders)
- ORD-2026-0081  klant-PO 7343276/9/00  transactie 249153555  aflever-GLN 4040051000082
- ORD-2026-0082  klant-PO 7343263/9/00  transactie 249153556  aflever-GLN 4040051000488
