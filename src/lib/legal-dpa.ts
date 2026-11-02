import type { LegalConfig } from './legal';
import { subprocessorTable, type LegalSection } from './legal-content';
import { BREACH_NOTICE_HOURS, DEFAULT_BACKUP_KEEP, POST_TERMINATION_EXPORT_DAYS, SUBPROCESSOR_NOTICE_DAYS } from './retention';

/**
 * The Data Processing Addendum (DPA).
 *
 * Built around what Article 28 of the GDPR requires a processor contract to contain, and written
 * from how the software actually behaves. The security measures in Annex II describe things the
 * code really does, and nothing it does not. A draft for a lawyer to review, not legal advice.
 */
export function dpaSections(c: LegalConfig): LegalSection[] {
  return [
    {
      id: 'scope',
      heading: '1. What this Addendum covers',
      paragraphs: [
        `This Data Processing Addendum ("Addendum") forms part of the Terms of Service between ${c.company} ("we", the "Processor") and the customer who uses Reclip ("you", the "Controller"). It applies automatically whenever we process personal data on your behalf in providing the Service, and no separate signature is needed. If you need a countersigned copy for your records, write to ${c.contactEmail} and we will send one.`,
        'If this Addendum conflicts with the Terms on how personal data is handled, this Addendum applies. All other terms, including the limits on liability, are as in the Terms.',
        '"Personal data", "controller", "processor", "processing", "personal data breach", "data subject" and "supervisory authority" have the meaning they have in the General Data Protection Regulation (EU) 2016/679 ("GDPR") and, where it applies, the UK GDPR and the Data Protection Act 2018, together "Data Protection Law".',
      ],
    },
    {
      id: 'roles',
      heading: '2. Our roles',
      paragraphs: [
        'For the personal data contained in the receipts, invoices, bank statement rows and other content you upload or import (the "Customer Data"), you are the controller and we are the processor. You decide what is uploaded and why; we process it only to provide the Service.',
        'For your account details, sign-in records and billing records, we are a controller in our own right, as the Privacy Policy explains. This Addendum does not cover that data.',
        'If you are yourself a processor acting for your own clients (for example, an accountant or bookkeeper), you confirm that you are authorised by them to engage us as a sub-processor on the terms of this Addendum, and you will pass their instructions to us only as far as this Addendum allows.',
      ],
    },
    {
      id: 'instructions',
      heading: '3. Your instructions',
      bullets: [
        'We process Customer Data only on your documented instructions. Your instructions are: the Terms, this Addendum, and what you do in the Service (uploading, importing, matching, editing, exporting and deleting). If we think an instruction breaks Data Protection Law, we will tell you straight away and may pause carrying it out until you confirm or change it.',
        'We will not process Customer Data for our own purposes. We do not sell it, use it for advertising, or use it to train any AI model.',
        'We may process it where the law requires, and we will tell you before doing so unless the law forbids that.',
        'You are responsible for having a lawful basis to upload Customer Data, for giving the notices data subjects are owed, and for not uploading data you have no right to upload.',
      ],
    },
    {
      id: 'confidentiality',
      heading: '4. Confidentiality',
      paragraphs: [
        'We give access to Customer Data only to people who need it to run, support and secure the Service, and who are bound by a duty of confidentiality. We do not look at your documents except where needed to support you at your request, to investigate abuse or a security problem, or where the law requires.',
      ],
    },
    {
      id: 'security',
      heading: '5. Security',
      paragraphs: [
        'We keep appropriate technical and organisational measures to protect Customer Data, taking into account the risks and the state of the art, as set out in Annex II. We may improve them over time but will not make them materially weaker.',
      ],
    },
    {
      id: 'subprocessors',
      heading: '6. Sub-processors',
      bullets: [
        'You give us general authorisation to use the sub-processors listed in Annex III.',
        `We will tell you by email at least ${SUBPROCESSOR_NOTICE_DAYS} days before we add or replace a sub-processor that will process Customer Data. If you object on reasonable data protection grounds within that time, we will work with you to find a solution. If we cannot, you may end the affected part of the Service and we will refund any prepaid fee for the period you can no longer use.`,
        'We have a written contract with each sub-processor that requires it to protect Customer Data to the standard of this Addendum, and we remain responsible to you for what they do on our behalf.',
      ],
    },
    {
      id: 'transfers',
      heading: '7. Where data is processed, and transfers',
      paragraphs: [
        `We host Customer Data in ${c.dataRegion}. We do not transfer it elsewhere except through the sub-processors in Annex III, or on your instruction.`,
        'Where Customer Data from the European Economic Area, Switzerland or the United Kingdom is transferred to a country that does not have an adequacy decision, the parties rely on the standard contractual clauses approved by the European Commission (Decision (EU) 2021/914), Module Two (controller to processor) between you and us, and Module Three (processor to processor) between us and our sub-processors, and for the United Kingdom the UK International Data Transfer Addendum. They are incorporated into this Addendum by reference, with the choices recorded in Annex I and the optional clauses applied as follows: the docking clause is included; the sub-processor option is the general authorisation in section 6; the governing law and courts are those of an EU member state chosen in the Terms, or if none, of Ireland.',
      ],
    },
    {
      id: 'rights',
      heading: '8. Requests from the people the data is about',
      bullets: [
        'The Service gives you the tools to deal with these requests yourself: you can search, correct, export and delete Customer Data.',
        'If a data subject writes to us about Customer Data, we will not answer it ourselves except to tell them to contact you, and we will pass the request to you promptly.',
        'We will give you reasonable help, within the limits of what the Service can do, so that you can answer requests to exercise rights under Data Protection Law.',
      ],
    },
    {
      id: 'assistance',
      heading: '9. Help with your other obligations',
      paragraphs: [
        'Taking into account the nature of the processing and the information available to us, we will help you meet your obligations on security, breach notification, data protection impact assessments and prior consultation with a supervisory authority. We may charge a reasonable fee for help that goes beyond what the Service and our normal support already provide.',
      ],
    },
    {
      id: 'breach',
      heading: '10. Personal data breaches',
      paragraphs: [
        `If we become aware of a personal data breach affecting Customer Data, we will tell you without undue delay, and in any event within ${BREACH_NOTICE_HOURS} hours, by email to the account owner.`,
        'The notice will say, as far as we then know: what happened; the kinds of data and the approximate number of people and records affected; the likely consequences; and what we have done and are doing about it. We will keep you updated as we learn more, give you what you reasonably need to meet your own duty to notify, and take reasonable steps to contain and fix the cause. A notice is not an admission of fault.',
      ],
    },
    {
      id: 'deletion',
      heading: '11. Return and deletion',
      bullets: [
        'While the agreement is in force you can export or delete Customer Data yourself at any time.',
        `When the agreement ends, you can export your data for ${POST_TERMINATION_EXPORT_DAYS} days. After that we delete it from our live systems.`,
        `Encrypted backups are overwritten on a fixed cycle, so Customer Data deleted from the live system can remain in a backup for up to ${DEFAULT_BACKUP_KEEP} days and is then destroyed. During that time it is kept encrypted, is not used for anything else, and is not restored except to recover from a failure of our own systems, after which it is deleted again.`,
        'We may keep a copy only where the law requires, and then only for as long as it does and under the protections of this Addendum. On request we will confirm in writing that we have deleted the data.',
      ],
    },
    {
      id: 'audit',
      heading: '12. Information and audits',
      paragraphs: [
        'We will give you the information reasonably needed to show that we comply with this Addendum, for example by answering a security questionnaire.',
        'If that does not satisfy you, or a supervisory authority requires it, you may audit our compliance once a year (and after a breach) on at least 30 days\' written notice, during normal working hours, in a way that does not disrupt our business or reveal other customers\' data or our confidential information. You pay the cost of the audit and for our reasonable time. An auditor must sign a confidentiality agreement. An audit of a sub-processor is limited to the reports and certifications that provider makes available to us.',
      ],
    },
    {
      id: 'liability',
      heading: '13. Liability',
      paragraphs: [
        'Each party\'s liability under or in connection with this Addendum is subject to the limits and exclusions in the Terms. Nothing here limits a data subject\'s rights, or liability that cannot lawfully be limited, or either party\'s liability to a supervisory authority.',
      ],
    },
    {
      id: 'term',
      heading: '14. How long this applies, and changes',
      paragraphs: [
        'This Addendum lasts as long as we process Customer Data for you, including the periods in section 11, and then ends. We may update it to follow changes in Data Protection Law or in how the Service works, on at least 30 days\' notice by email; if you do not agree, you may close your account before the change takes effect.',
        `It is governed by the same law as the Terms (${c.governingLaw}), except that the standard contractual clauses are governed as stated in section 7.`,
      ],
    },
    {
      id: 'annex-1',
      heading: 'Annex I. Details of the processing',
      table: {
        head: ['Item', 'Description'],
        rows: [
          ['Subject matter', 'Reading, storing, matching and exporting your receipts, invoices and bank statement rows, so that you can reconcile them'],
          ['Duration', 'For as long as you use the Service, plus the periods in section 11'],
          ['Nature of the processing', 'Storage; reading text and amounts from documents (including, where enabled, by an AI provider for photographed receipts); comparing and matching; displaying; editing; exporting; deleting; making encrypted backups'],
          ['Purpose', 'To provide the Service to you and no other purpose'],
          ['Types of personal data', 'Names, business names and addresses printed on receipts and invoices; transaction details (date, merchant, amount, currency, bank description text, references); payment method and card digits if shown on a receipt; invoice numbers; any other personal data that appears in a document you upload'],
          ['People the data is about', 'Your customers and clients, your suppliers and their staff, your employees and contractors, card holders, and anyone else named in the documents you upload'],
          ['Special categories of data', 'Not intended. Please do not upload documents that contain them, such as health or union membership information. If a receipt reveals such data by its nature (for example, a pharmacy receipt), you are responsible for the lawful basis for it'],
          ['Frequency', 'Continuous, for as long as you use the Service'],
          ['Retention', 'Until you delete the data, or as described in section 11'],
          ['Your contact for this Addendum', 'The account owner\'s email address'],
          ['Our contact', `${c.contactEmail}`],
          ['Competent supervisory authority', c.supervisoryAuthority],
        ],
      },
    },
    {
      id: 'annex-2',
      heading: 'Annex II. Technical and organisational security measures',
      paragraphs: ['This is what the Service does today to protect Customer Data.'],
      bullets: [
        'In transit: all traffic uses HTTPS, with a strict transport security header and a content security policy on every page.',
        'Passwords are stored only as salted hashes. Sign-in tokens are stored only as hashes and expire. All other sessions are signed out when a password changes.',
        'Access control: every request is tied to a signed-in user and a workspace, and every database query is limited to that workspace. Tests check that one customer cannot reach another customer\'s data through any read or write path. Uploaded documents are served only to a signed-in member of the workspace that owns them, and are never publicly addressable.',
        'Documents are stored in private object storage, under keys that include the workspace, and are checked by their real content (not only their name) before being accepted.',
        'Abuse protection: temporary account lockout after repeated wrong passwords, and rate limits on sign-in, upload, export and other sensitive actions, shared across all servers.',
        'Email addresses are confirmed before use of the Service, where email is configured.',
        'Backups: a consistent daily snapshot, encrypted with AES-256-GCM before it leaves the application, with the key held separately from the data, kept for a fixed number of days, and restorable only into an empty database.',
        'Logging and monitoring: security events (sign-ins, failures, lockouts, password changes) are recorded for the account holder to see; changes to financial data are written to an activity log; error reports leave our systems only after personal data, cookies, request bodies and query values are removed; a health check watches the database, background processing and backups.',
        'Data minimisation: we do not collect payment card numbers, do not connect to your bank, and do not use advertising or analytics trackers.',
        'Deletion: you can delete a receipt, a workspace or your whole account, and the stored files are removed with the records.',
        'Organisation: access to production systems is limited to the people who need it to run and support the Service, and is protected with strong authentication where the provider offers it.',
        'Changes to the Service are covered by automated tests before release, and database changes are applied by recorded, repeatable migrations.',
      ],
    },
    {
      id: 'annex-3',
      heading: 'Annex III. Sub-processors',
      paragraphs: [`These providers process Customer Data for us. We host Customer Data in ${c.dataRegion}. We will tell you of changes as set out in section 6.`],
      table: subprocessorTable(c),
    },
  ];
}
