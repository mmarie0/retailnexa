import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv-export';

describe('csvCell (#27 L1)', () => {
  it('neutralizes formula-looking text', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(' =x')).toBe("' =x");
    expect(csvCell('  +1')).toBe("'  +1");
    expect(csvCell('\t=x')).toBe("'\t=x");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it('leaves numbers and plain text alone, and quotes when needed', () => {
    expect(csvCell(-1250)).toBe('-1250');
    expect(csvCell('Register 1')).toBe('Register 1');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
  });

  it('builds a CRLF file', () => {
    expect(toCsv(['a', 'b'], [[1, '=x']])).toBe("a,b\r\n1,'=x\r\n");
  });
});
