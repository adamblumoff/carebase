const decodeQuotedPrintableWord = (value: string) => {
  // RFC 2047 "Q" encoding: "_" represents space; "=XX" hex escapes.
  const withSpaces = value.replace(/_/g, ' ');
  return withSpaces.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
};

const decodeEncodedWord = (charsetRaw: string, encodingRaw: string, text: string) => {
  const charset = charsetRaw.trim().toLowerCase();
  const encoding = encodingRaw.trim().toLowerCase();

  try {
    if (encoding === 'b') {
      const buffer = Buffer.from(text, 'base64');
      // Node supports 'latin1' and 'utf8' reliably; map common aliases.
      const nodeCharset =
        charset === 'utf-8' || charset === 'utf8'
          ? 'utf8'
          : charset === 'iso-8859-1' || charset === 'latin1'
            ? 'latin1'
            : 'utf8';
      return buffer.toString(nodeCharset);
    }

    if (encoding === 'q') {
      const decoded = decodeQuotedPrintableWord(text);
      return decoded;
    }
  } catch {
    // Fall through to returning null.
  }

  return null;
};

export const decodeRfc2047HeaderValue = (value: string) => {
  // Decode RFC 2047 "encoded-words": =?charset?b|q?encoded?=
  // Multiple encoded-words can appear in a single header; decode each and normalize whitespace.
  const decoded = value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (m, cs, enc, txt) => {
    const out = decodeEncodedWord(cs, enc, txt);
    return out ?? m;
  });
  // Collapse repeated whitespace introduced by encoded-word boundaries.
  return decoded.replace(/[ \t\f\v]+/g, ' ').trim();
};
