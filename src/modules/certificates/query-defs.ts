// X02-T8 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/certificates.<fn> (mirrors src/modules/lifecycle/query-defs.ts;
// printHtml follows exams.reportCardHtml's `{ html }` + ?format=html shape).
import { defineQuery } from "@/lib/actions/define-query";
import { CertificateListSchema, CertificatePrintSchema, IdCardsSchema } from "./schemas.ts";
import { certificateHtml, listCertificates } from "./queries.ts";
import { idCardsHtml } from "./id-cards.queries.ts";

export const certificatesListQuery = defineQuery({
  name: "certificates.list",
  module: "certificates",
  schema: CertificateListSchema,
  permission: "certificate.manage",
  handler: (input, ctx) => listCertificates(ctx, input),
});

export const certificatesPrintHtmlQuery = defineQuery({
  name: "certificates.printHtml",
  module: "certificates",
  schema: CertificatePrintSchema,
  permission: "certificate.manage",
  handler: (input, ctx) => certificateHtml(ctx, input.certificateId),
});

export const certificatesIdCardsHtmlQuery = defineQuery({
  name: "certificates.idCardsHtml",
  module: "certificates",
  schema: IdCardsSchema,
  permission: "certificate.manage",
  handler: (input, ctx) => idCardsHtml(ctx, input.classSectionId),
});
