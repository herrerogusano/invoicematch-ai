import { catalog } from "@/fixtures";
import { documentTotals, formatMoney, lineAmounts } from "@/domain/money";
import { withTransaction } from "./pool";
import { insertInvoice } from "./repository";

/** Idempotent: re-running leaves exactly one copy of every fixture row. */
export async function seed(log: (msg: string) => void = console.log): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('invoicematch-seed'))");
    for (const s of catalog.suppliers) {
      await client.query(
        `insert into app.suppliers (code, name, tax_id) values ($1, $2, $3)
         on conflict (code) do update set name = excluded.name, tax_id = excluded.tax_id`,
        [s.code, s.name, s.taxId ?? null],
      );
    }
    for (const po of catalog.purchaseOrders) {
      const exists = await client.query("select 1 from app.purchase_orders where po_number = $1", [po.poNumber]);
      if (exists.rowCount) continue;
      const t = documentTotals(po.lines, po.currency);
      const { rows } = await client.query<{ id: string }>(
        `insert into app.purchase_orders (po_number, supplier_id, currency, status, subtotal, tax, total)
         select $1, id, $3, $4, $5, $6, $7 from app.suppliers where code = $2
         returning id`,
        [po.poNumber, po.supplierCode, po.currency, po.status, formatMoney(t.subtotal, po.currency), formatMoney(t.tax, po.currency), formatMoney(t.total, po.currency)],
      );
      const poId = rows[0]?.id;
      if (!poId) throw new Error(`unknown supplier ${po.supplierCode} for ${po.poNumber}`);
      for (const [i, l] of po.lines.entries()) {
        await client.query(
          `insert into app.purchase_order_lines
             (purchase_order_id, line_id, position, sku, description, quantity, unit_price, tax_rate, line_subtotal)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [poId, l.lineId, i, l.sku ?? null, l.description, l.quantity, l.unitPrice, l.taxRate, formatMoney(lineAmounts(l, po.currency).subtotal, po.currency)],
        );
      }
    }
    for (const inv of catalog.historicalInvoices) {
      const exists = await client.query(
        `select 1 from app.invoices i join app.suppliers s on s.id = i.supplier_id
         where s.code = $1 and i.invoice_number = $2 and i.is_historical`,
        [inv.supplierCode, inv.invoiceNumber],
      );
      if (exists.rowCount) continue;
      const sup = await client.query<{ id: string }>("select id from app.suppliers where code = $1", [inv.supplierCode]);
      await insertInvoice(client, inv, sup.rows[0]!.id, { historical: true });
    }
  });
  log(`seeded ${catalog.suppliers.length} suppliers, ${catalog.purchaseOrders.length} purchase orders, ${catalog.historicalInvoices.length} historical invoices`);
}
