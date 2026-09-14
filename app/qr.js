/* ══════════════════════════════════════════════════════════════════════════════
   QR encoder — byte mode, error-correction level M, versions 1–6.

   Deliberately a narrow slice of ISO/IEC 18004. Byte mode only, because a Google
   Drive folder ID is mixed case with "-" and "_" and alphanumeric mode cannot carry
   those. Level M (15% recovery) because the sheet gets photocopied before it is
   scanned. Versions stop at 6: the routing payload is 54 bytes, v4 holds 62, and
   v7+ would drag in the version-information block for capacity we will never use.

   No dependencies, no module syntax, no build step — this has to load from a plain
   <script> tag in a page opened by double-clicking it (ARCH-04). The tail exports
   for Node so tools/qr-selftest.mjs can round-trip it without a browser.
   ══════════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  'use strict';
  var QR = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
  else root.QR = QR;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Version table, level M ────────────────────────────────────────────────
     total  — codewords in the whole symbol
     ecPer  — error-correction codewords per block
     blocks — number of blocks
     Every version through 6 has equal-sized blocks at level M, which is why the
     interleaver below does not need the spec's two-group handling. */
  var VERSIONS = {
    1: { total: 26, ecPer: 10, blocks: 1 },
    2: { total: 44, ecPer: 16, blocks: 1 },
    3: { total: 70, ecPer: 26, blocks: 1 },
    4: { total: 100, ecPer: 18, blocks: 2 },
    5: { total: 134, ecPer: 24, blocks: 2 },
    6: { total: 172, ecPer: 16, blocks: 4 }
  };
  var MIN_VERSION = 1;
  var MAX_VERSION = 6;
  /* Capped at 4 on purpose. The routing payload is 54 bytes and v4 holds 62, so
     every real code lands on v4 anyway — but a cap means a payload that grows past
     the budget FAILS rather than silently stepping up to v5, where the modules get
     smaller and the scan margin quietly shrinks. Raise this only alongside a new
     look at px-per-module at the printed size. */
  var DEFAULT_MAX_VERSION = 4;

  function sizeOf(version) { return version * 4 + 17; }
  function dataCodewords(version) {
    var v = VERSIONS[version];
    return v.total - v.ecPer * v.blocks;
  }
  /* 4 bits of mode indicator plus 8 bits of character count = 12 bits of overhead,
     so the usable byte count is two codewords short of the data capacity. */
  function byteCapacity(version) { return dataCodewords(version) - 2; }

  /* ── GF(256), primitive polynomial 0x11D ──────────────────────────────────── */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function initGaloisField() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* Generator polynomial for `degree` error-correction codewords. */
  function rsGenerator(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var i = 0; i < poly.length; i++) {
        next[i] ^= poly[i];
        next[i + 1] ^= gfMul(poly[i], EXP[d]);
      }
      poly = next;
    }
    return poly;
  }

  /* Remainder of data × x^ecLen divided by the generator — the EC codewords. */
  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var rem = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem[0];
      rem.shift();
      rem.push(0);
      for (var j = 0; j < ecLen; j++) rem[j] ^= gfMul(gen[j + 1], factor);
    }
    return rem;
  }

  /* ── Bitstream ─────────────────────────────────────────────────────────────── */
  function toBytes(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    var out = [];                                   // Node <11 / very old engines
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }

  function chooseVersion(byteLen, maxVersion) {
    var cap = maxVersion || DEFAULT_MAX_VERSION;
    for (var v = MIN_VERSION; v <= cap; v++) {
      if (byteCapacity(v) >= byteLen) return v;
    }
    throw new Error(
      'QR: payload is ' + byteLen + ' bytes; version ' + cap + ' at level M holds ' +
      byteCapacity(cap) + '. Shorten the run ID rather than raising the version — a ' +
      'bigger symbol means smaller modules at the same 2cm and a worse scan margin.'
    );
  }

  /* Mode indicator, 8-bit count, payload, terminator, then alternating pad bytes. */
  function buildCodewords(bytes, version) {
    var bits = [];
    function push(value, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
    }
    push(0x4, 4);                                   // byte mode
    push(bytes.length, 8);                          // count — 8 bits for versions 1–9
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var capacityBits = dataCodewords(version) * 8;
    var terminator = Math.min(4, capacityBits - bits.length);
    for (var t = 0; t < terminator; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    var codewords = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      codewords.push(byte);
    }
    var pads = [0xec, 0x11];
    for (var p = 0; codewords.length < dataCodewords(version); p++) {
      codewords.push(pads[p % 2]);
    }
    return codewords;
  }

  /* Split into blocks, compute EC per block, then interleave both sets column-wise. */
  function interleave(codewords, version) {
    var spec = VERSIONS[version];
    var perBlock = dataCodewords(version) / spec.blocks;
    var dataBlocks = [];
    var ecBlocks = [];
    for (var b = 0; b < spec.blocks; b++) {
      var block = codewords.slice(b * perBlock, (b + 1) * perBlock);
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, spec.ecPer));
    }
    var out = [];
    for (var i = 0; i < perBlock; i++) {
      for (var d = 0; d < dataBlocks.length; d++) out.push(dataBlocks[d][i]);
    }
    for (var j = 0; j < spec.ecPer; j++) {
      for (var e = 0; e < ecBlocks.length; e++) out.push(ecBlocks[e][j]);
    }
    return out;
  }

  /* ── Matrix construction ───────────────────────────────────────────────────── */
  function blankMatrix(size) {
    var m = [];
    for (var r = 0; r < size; r++) m.push(new Array(size).fill(null));
    return m;
  }

  function placeFinder(m, reserved, top, left) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = top + r, cc = left + c;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var inRing =
          r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        m[rr][cc] = inRing ? 1 : 0;                 // separators land as forced light
        reserved[rr][cc] = true;
      }
    }
  }

  function placeAlignment(m, reserved, version) {
    if (version < 2) return;                        // version 1 has none
    var centre = version * 4 + 10;                  // single pattern for versions 2–6
    for (var r = -2; r <= 2; r++) {
      for (var c = -2; c <= 2; c++) {
        m[centre + r][centre + c] =
          (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) ? 1 : 0;
        reserved[centre + r][centre + c] = true;
      }
    }
  }

  function reserveFormat(m, reserved, size) {
    for (var i = 0; i <= 8; i++) {
      if (i !== 6) { reserved[8][i] = true; reserved[i][8] = true; }
    }
    for (var j = 0; j < 8; j++) {
      reserved[8][size - 1 - j] = true;
      reserved[size - 1 - j][8] = true;
    }
    m[size - 8][8] = 1;                             // the always-dark module
    reserved[size - 8][8] = true;
  }

  function buildFrame(version) {
    var size = sizeOf(version);
    var m = blankMatrix(size);
    var reserved = [];
    for (var r = 0; r < size; r++) reserved.push(new Array(size).fill(false));

    placeFinder(m, reserved, 0, 0);
    placeFinder(m, reserved, 0, size - 7);
    placeFinder(m, reserved, size - 7, 0);

    for (var i = 8; i < size - 8; i++) {            // timing patterns
      var bit = i % 2 === 0 ? 1 : 0;
      m[6][i] = bit; reserved[6][i] = true;
      m[i][6] = bit; reserved[i][6] = true;
    }

    placeAlignment(m, reserved, version);
    reserveFormat(m, reserved, size);
    return { matrix: m, reserved: reserved, size: size };
  }

  /* Zigzag upward/downward in column pairs from the right edge, skipping column 6. */
  function placeData(m, reserved, codewords) {
    var size = m.length;
    var bits = [];
    for (var i = 0; i < codewords.length; i++) {
      for (var b = 7; b >= 0; b--) bits.push((codewords[i] >> b) & 1);
    }
    var idx = 0;
    var upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;                       // the vertical timing column
      for (var step = 0; step < size; step++) {
        var row = upward ? size - 1 - step : step;
        for (var k = 0; k < 2; k++) {
          var c = col - k;
          if (reserved[row][c]) continue;
          m[row][c] = idx < bits.length ? bits[idx] : 0;
          idx++;
        }
      }
      upward = !upward;
    }

    /* Free self-check. Version 4 has 1089 modules, of which 282 are function
       patterns, leaving 807 placeable bits = 100 codewords + 7 remainder. If the
       zigzag or the reserved map is wrong this trips immediately, rather than
       producing a symbol that fails to decode for no visible reason. */
    var placeable = 0;
    for (var rr = 0; rr < size; rr++) {
      for (var cc = 0; cc < size; cc++) if (!reserved[rr][cc]) placeable++;
    }
    if (idx !== placeable) {
      throw new Error('QR: placed ' + idx + ' bits into ' + placeable + ' free modules.');
    }
    if (bits.length > placeable) {
      throw new Error('QR: ' + bits.length + ' data bits exceed ' + placeable + ' free modules.');
    }
  }

  /* ── Masking ───────────────────────────────────────────────────────────────── */
  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
    function (i, j) { return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0; }
  ];

  function applyMask(m, reserved, maskId) {
    var out = m.map(function (row) { return row.slice(); });
    for (var r = 0; r < m.length; r++) {
      for (var c = 0; c < m.length; c++) {
        if (!reserved[r][c] && MASKS[maskId](r, c)) out[r][c] ^= 1;
      }
    }
    return out;
  }

  /* The four penalty rules from the spec, used to pick the least patterned mask. */
  function penalty(m) {
    var size = m.length;
    var score = 0;
    var r, c, run, i;

    for (r = 0; r < size; r++) {                    // rule 1 — runs of five or more
      run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) { run++; }
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) { run++; }
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }

    for (r = 0; r < size - 1; r++) {                // rule 2 — 2×2 blocks
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    var FINDER = [1, 0, 1, 1, 1, 0, 1];             // rule 3 — finder-like 1:1:3:1:1
    var LIGHT4 = [0, 0, 0, 0];
    function matches(get, start, pattern) {
      for (var k = 0; k < pattern.length; k++) {
        if (get(start + k) !== pattern[k]) return false;
      }
      return true;
    }
    function scanLine(get, len) {
      for (var s = 0; s + 7 <= len; s++) {
        if (!matches(get, s, FINDER)) continue;
        var before = s - 4 >= 0 && matches(get, s - 4, LIGHT4);
        var after = s + 7 + 4 <= len && matches(get, s + 7, LIGHT4);
        if (before || after) score += 40;
      }
    }
    for (r = 0; r < size; r++) {
      (function (row) { scanLine(function (k) { return m[row][k]; }, size); })(r);
    }
    for (c = 0; c < size; c++) {
      (function (col) { scanLine(function (k) { return m[k][col]; }, size); })(c);
    }

    var dark = 0;                                   // rule 4 — dark/light balance
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += m[r][c];
    var percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;
    return score;
  }

  /* ── Format information — BCH(15,5), level M is 0b00 ───────────────────────── */
  function formatBits(maskId) {
    var data = (0x0 << 3) | maskId;                 // level M
    var value = data << 10;
    for (var i = 14; i >= 10; i--) {
      if ((value >> i) & 1) value ^= 0x537 << (i - 10);
    }
    return ((data << 10) | value) ^ 0x5412;
  }

  /* Two copies of the 15 bits: a strip down column 8 and a strip along row 8.
     Note the vertical strip skips row 6 (the timing line) and steps over the dark
     module at (size-8, 8) — that module is not format information and must stay dark. */
  function placeFormat(m, maskId) {
    var size = m.length;
    var bits = formatBits(maskId);
    for (var i = 0; i < 15; i++) {
      var bit = (bits >> i) & 1;
      if (i < 6) m[i][8] = bit;                     // column 8, above the timing row
      else if (i < 8) m[i + 1][8] = bit;            // rows 7 and 8
      else m[size - 15 + i][8] = bit;               // rows size-7 … size-1

      if (i < 8) m[8][size - i - 1] = bit;          // row 8, from the right edge
      else if (i === 8) m[8][7] = bit;
      else m[8][14 - i] = bit;                      // cols 5 … 0
    }
  }

  /* ── Public API ────────────────────────────────────────────────────────────── */
  function encode(text) {
    var bytes = toBytes(text);
    var version = chooseVersion(bytes.length);
    var codewords = interleave(buildCodewords(bytes, version), version);

    var frame = buildFrame(version);
    placeData(frame.matrix, frame.reserved, codewords);

    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var candidate = applyMask(frame.matrix, frame.reserved, mask);
      placeFormat(candidate, mask);
      var score = penalty(candidate);
      if (!best || score < best.score) best = { score: score, mask: mask, matrix: candidate };
    }
    return {
      text: text,
      version: version,
      size: frame.size,
      mask: best.mask,
      modules: best.matrix.map(function (row) {
        return row.map(function (v) { return v === 1; });
      })
    };
  }

  /* ── Rendering ──────────────────────────────────────────────────────────────
     Inline SVG, with the viewBox in MODULE units so every coordinate is an integer
     and nothing lands on a fractional pixel.

     `box` is the full printed width in CSS px including the quiet zone. The default
     94 puts the symbol itself at 94 × 33/41 = 75.7px = 20.0mm — a 2cm code, which is
     the size this teacher already knows survives their copier.

     Three choices worth their comments:

     · ONE <path>, not a rect per run. Adjacent subpaths inside a single path fill as
       one region, so the renderer never anti-aliases an interior edge. Separate rects
       are each anti-aliased and can leave hairline seams at fractional print scales —
       exactly the artefact that makes a decoder mis-measure module size.
     · fill #000, not the book's #1a1a2e. A fourth deliberate departure, same reasoning
       as the other three: #1a1a2e is ~12% luminance, and after a photocopy generation
       plus a scan that margin is worth having.
     · The white rect and black path are SVG PAINT, not CSS background. They print
       whether or not "Background graphics" is ticked — that setting governs CSS
       backgrounds on HTML boxes and has no bearing on SVG geometry. */
  function toSvg(result, options) {
    var opts = options || {};
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var span = result.size + quiet * 2;             // 41 modules for version 4
    var box = opts.box || 94;
    var d = [];
    for (var r = 0; r < result.size; r++) {
      var c = 0;
      while (c < result.size) {
        if (!result.modules[r][c]) { c++; continue; }
        var run = 0;
        while (c + run < result.size && result.modules[r][c + run]) run++;
        d.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h' + run + 'v1h-' + run + 'z');
        c += run;
      }
    }
    return '<svg width="' + box + '" height="' + box + '" viewBox="0 0 ' + span + ' ' + span +
      '" shape-rendering="crispEdges" data-qr="true" role="img" aria-label="' +
      (opts.label || 'Routing code') + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="' + span + '" height="' + span + '" fill="#fff"/>' +
      '<path d="' + d.join('') + '" fill="#000"/></svg>';
  }

  /* Raw RGBA for tests and for anything that wants pixels without a canvas.
     `scale` is pixels per module, which is the number that decides whether a decoder
     can read it: a 2cm code in a 200 DPI scan arrives at about 4.8. */
  function toImageData(result, scale, quiet) {
    var px = scale || 8;
    var q = quiet === undefined ? 4 : quiet;
    var dim = (result.size + q * 2) * px;
    var data = new Uint8ClampedArray(dim * dim * 4).fill(255);
    for (var r = 0; r < result.size; r++) {
      for (var c = 0; c < result.size; c++) {
        if (!result.modules[r][c]) continue;
        for (var y = 0; y < px; y++) {
          for (var x = 0; x < px; x++) {
            var i = (((r + q) * px + y) * dim + ((c + q) * px + x)) * 4;
            data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
          }
        }
      }
    }
    return { data: data, width: dim, height: dim };
  }

  return {
    encode: encode,
    toSvg: toSvg,
    toImageData: toImageData,
    formatBits: formatBits,
    byteCapacity: byteCapacity,
    VERSIONS: VERSIONS
  };
});
