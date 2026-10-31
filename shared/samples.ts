/**
 * Synthetic sample documents. All vendors, customers and numbers are fictitious.
 * Used by the UI sample picker and by the tests.
 */

export interface Sample {
  id: string;
  label: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'clean',
    label: 'Clean invoice (pipe-delimited table)',
    text: `SYNTHETIC SAMPLE - fictitious data for demonstration only

INVOICE

Invoice Number: INV-2025-0142
Invoice Date: 2025-03-14
Due Date: 2025-04-13
Vendor: Brightwater Office Supply LLC
Bill To: Example Customer Inc.

Description | Qty | Unit Price | Amount
Ergonomic desk chair | 4 | 189.50 | 758.00
Standing desk converter | 2 | 245.00 | 490.00
Printer paper (case of 10 reams) | 6 | 42.75 | 256.50
Shipping & handling | 1 | 35.00 | 35.00

Subtotal: $1,539.50
Tax (8.25%): $127.01
Total: $1,666.51
`,
  },
  {
    id: 'alternate',
    label: 'Alternate layout (EUR, aligned columns, written dates)',
    text: `SYNTHETIC SAMPLE - fictitious data for demonstration only

KESTREL LOGISTICS GMBH
Rechnung / Invoice

Invoice No. KL-88213
Date issued: 3 March 2025
Payment due: 2 April 2025
Currency: EUR
Supplier: Kestrel Logistics GmbH

Description                     Qty    Unit Price    Amount
Pallet transport Hamburg-Lyon     3      420.00     1,260.00
Customs documentation             1       85.00        85.00
Fuel surcharge                    1       63.45        63.45

Subtotal                                          1,408.45
VAT 19%                                             267.61
Amount due                                        1,676.06
`,
  },
  {
    id: 'problems',
    label: 'Needs review (invalid date, arithmetic mismatches)',
    text: `SYNTHETIC SAMPLE - fictitious data; deliberately contains problems

INVOICE
Invoice #: HP-3307
Invoice Date: 2025-02-30
Vendor: Harbor & Pine Catering
Currency: USD

Description | Qty | Unit Price | Amount
Corporate lunch (per person) | 25 | 18.00 | 450.00
Beverage service | 1 | 120.00 | 150.00

Subtotal: $570.00
Tax: $45.60
Total: $620.00
`,
  },
];

export const getSample = (id: string): Sample => {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) throw new Error(`Unknown sample: ${id}`);
  return sample;
};
