/* Turning a list of per-page decode results into per-student packets.

   Deliberately pure — no PDF, no filesystem, no rendering. Every edge case that
   matters can therefore be tested with a hand-written array in milliseconds, which
   is where the boundary rule gets its real coverage.

   THE BOUNDARY RULE: a routing code starts a packet, and every page after it
   belongs to that student until the next code. Nothing else is inferred. */
import { parsePayload } from './pdf.mjs';

export function buildPackets(pageResults, roster, options = {}) {
  const expectedRun = options.runId || null;
  const byFolder = new Map(roster.students.map((s) => [s.folderId, s]));

  const packets = [];
  const issues = [];
  const leading = [];
  let current = null;

  for (const page of pageResults) {
    if (!page.payload) {
      if (current) current.pages.push(page.n);
      else leading.push(page.n);
      continue;
    }

    const parsed = parsePayload(page.payload);
    if (!parsed.ok) {
      issues.push({ kind: 'unreadable_payload', severity: 'error', page: page.n,
        message: `Page ${page.n} carries a code that is not folderId|runId|studentId ` +
          `(${parsed.reason}). It was left with the previous packet.` });
      if (current) current.pages.push(page.n); else leading.push(page.n);
      continue;
    }

    if (expectedRun && parsed.runId !== expectedRun) {
      issues.push({ kind: 'wrong_run', severity: 'error', page: page.n,
        runId: parsed.runId,
        message: `Page ${page.n} belongs to run ${parsed.runId}, not ${expectedRun}. ` +
          `That is a sheet from another assignment in this stack.` });
      if (current) current.pages.push(page.n); else leading.push(page.n);
      continue;
    }

    const student = byFolder.get(parsed.folderId);
    if (!student) {
      issues.push({ kind: 'unknown_student', severity: 'error', page: page.n,
        folderId: parsed.folderId,
        message: `Page ${page.n} names a folder that is not on this roster.` });
      if (current) current.pages.push(page.n); else leading.push(page.n);
      continue;
    }

    current = {
      student, folderId: parsed.folderId, runId: parsed.runId,
      studentId: parsed.studentId, startPage: page.n, pages: [page.n], flags: []
    };
    packets.push(current);
  }

  if (leading.length) {
    issues.push({ kind: 'leading_pages', severity: 'error', pages: leading,
      message: `${leading.length} page(s) came before the first routing code, so there ` +
        `is nothing to attribute them to. Most often this is a sheet that went through ` +
        `face-down, or a student who stapled their work on top.` });
  }

  /* Duplex means every physical sheet contributes two pages, so an odd packet has
     lost a page or swallowed a code. Cheap, and it catches a missed code on the
     LAST student, where the count check alone would not. */
  for (const packet of packets) {
    if (packet.pages.length % 2 !== 0) {
      packet.flags.push('odd_page_count');
      issues.push({ kind: 'odd_page_count', severity: 'warning',
        folderId: packet.folderId, student: name(packet.student),
        message: `${name(packet.student)} has ${packet.pages.length} pages. A duplex scan ` +
          `gives two per sheet, so an odd count means a page was dropped or a code missed.` });
    }
  }

  /* A packet that swallowed a neighbour is roughly double-sized. */
  if (packets.length > 2) {
    const lengths = packets.map((p) => p.pages.length).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    for (const packet of packets) {
      if (packet.pages.length >= median * 2 && packet.pages.length > median + 2) {
        packet.flags.push('suspicious_length');
        issues.push({ kind: 'suspicious_length', severity: 'warning',
          folderId: packet.folderId, student: name(packet.student),
          message: `${name(packet.student)} has ${packet.pages.length} pages against a ` +
            `typical ${median}. A packet about twice the usual length has usually ` +
            `swallowed the next student, whose code went unread.` });
      }
    }
  }

  /* Same student twice. Never merged by default: the "duplicate" may be a misdecode
     of a neighbour's code, and merging would interleave two students invisibly. */
  const counts = new Map();
  for (const packet of packets) {
    counts.set(packet.folderId, (counts.get(packet.folderId) || 0) + 1);
  }
  for (const [folderId, n] of counts) {
    if (n < 2) continue;
    const involved = packets.filter((p) => p.folderId === folderId);
    involved.forEach((p, i) => { p.part = i + 1; p.partsTotal = n; });
    issues.push({ kind: 'duplicate_code', severity: 'error', folderId,
      student: name(involved[0].student),
      pages: involved.map((p) => p.startPage),
      message: `${name(involved[0].student)} appears ${n} times, starting at pages ` +
        `${involved.map((p) => p.startPage).join(' and ')}. Written as separate parts ` +
        `rather than merged, because one of them may be a misread of someone else's code.` });
  }

  for (const student of roster.students) {
    if (counts.has(student.folderId)) continue;
    issues.push({ kind: 'missing_student', severity: 'error',
      folderId: student.folderId, student: name(student),
      message: `No routing code for ${name(student)} was found. Their work is most ` +
        `likely inside whichever packet came back longest.` });
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    packets, issues, leading,
    ok: errors.length === 0,
    summary: {
      pagesTotal: pageResults.length,
      packetsFound: packets.length,
      packetsExpected: roster.students.length,
      pagesUnmatched: leading.length,
      errors: errors.length,
      warnings: issues.length - errors.length
    }
  };
}

export function name(student) {
  return `${student.last}, ${student.first}`;
}

export function fileNameFor(packet) {
  const base = `${packet.student.last}-${packet.student.first}`.replace(/[^\w-]/g, '');
  const part = packet.part ? `__part${packet.part}` : '';
  return `${base}${part}__${packet.folderId}.pdf`;
}
