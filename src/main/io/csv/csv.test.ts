import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError } from '@shared/io/types';
import {
  detectDelimiter,
  mapHeaders,
  parseDelimited,
  readCsv,
} from './read';
import { CSV_COLUMNS, writeCsv } from './write';

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), 'test-data', name), 'utf8');

// ----------------------------------------------------------------- tokeniser

describe('parseDelimited', () => {
  it('splits plain rows', () => {
    expect(parseDelimited('a,b\n1,2\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a delimiter inside quotes as content', () => {
    expect(parseDelimited('a,b\n"one, two",3\n', ',')).toEqual([
      ['a', 'b'],
      ['one, two', '3'],
    ]);
  });

  it('keeps a newline inside quotes as content', () => {
    expect(parseDelimited('a\n"one\ntwo"\n', ',')).toEqual([
      ['a'],
      ['one\ntwo'],
    ]);
  });

  it('reads a doubled quote as one literal quote', () => {
    expect(parseDelimited('a\n"say ""hi"""\n', ',')).toEqual([
      ['a'],
      ['say "hi"'],
    ]);
  });

  it('treats CRLF as one row terminator, not an empty row', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads a final row with no trailing newline', () => {
    expect(parseDelimited('a,b\n1,2', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('preserves empty fields rather than collapsing them', () => {
    expect(parseDelimited('a,b,c\n1,,3\n', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });
});

describe('detectDelimiter', () => {
  it('picks a comma', () => {
    expect(detectDelimiter('name,lat,lon\n')).toBe(',');
  });

  it('picks a semicolon, as European Excel writes', () => {
    expect(detectDelimiter('Title;Lat;Long\n')).toBe(';');
  });

  it('picks a tab', () => {
    expect(detectDelimiter('name\tlat\tlon\n')).toBe('\t');
  });

  it('ignores delimiters inside a quoted header', () => {
    expect(detectDelimiter('"a;b;c";lat\nx')).toBe(';');
  });

  it('defaults to a comma for a single-column file', () => {
    expect(detectDelimiter('name\n')).toBe(',');
  });
});

// ------------------------------------------------------------ header mapping

describe('mapHeaders', () => {
  it('maps the canonical columns', () => {
    const map = mapHeaders([
      'name',
      'latitude',
      'longitude',
      'elevation',
      'description',
      'symbol',
      'time',
    ]);
    expect(map).toMatchObject({
      name: 0,
      lat: 1,
      lon: 2,
      ele: 3,
      description: 4,
      symbol: 5,
      time: 6,
    });
    expect(map.extra).toEqual({});
  });

  it('maps aliases, ignoring case, punctuation and units', () => {
    const map = mapHeaders(['Title', 'Lat.', 'Long', 'Alt (m)', 'Notes']);
    expect(map).toMatchObject({
      name: 0,
      lat: 1,
      lon: 2,
      ele: 3,
      description: 4,
    });
  });

  it('maps bare x/y/z coordinate headers', () => {
    expect(mapHeaders(['Y', 'X', 'Z'])).toMatchObject({
      lat: 0,
      lon: 1,
      ele: 2,
    });
  });

  it('records an unrecognised column rather than discarding it', () => {
    const map = mapHeaders(['name', 'lat', 'lon', 'Difficulty']);
    expect(map.extra).toEqual({ 3: 'Difficulty' });
  });

  it('keeps the first match when a header repeats', () => {
    const map = mapHeaders(['lat', 'latitude', 'lon']);
    expect(map.lat).toBe(0);
    expect(map.extra).toEqual({ 1: 'latitude' });
  });
});

// ---------------------------------------------------------------------- read

describe('readCsv', () => {
  const file = readCsv(fixture('waypoints.csv'), '/tmp/waypoints.csv');

  it('reports the format and source name', () => {
    expect(file.format).toBe('csv');
    expect(file.sourceName).toBe('waypoints.csv');
  });

  it('reads every row', () => {
    expect(file.waypoints).toHaveLength(4);
    expect(file.tracks).toHaveLength(0);
    expect(file.routes).toHaveLength(0);
  });

  it('reads coordinates and elevation exactly', () => {
    expect(file.waypoints[0]).toMatchObject({
      name: 'Grimsel Hut',
      lat: 46.5197,
      lon: 8.012,
      ele: 1850.5,
      description: 'Overnight stop',
      symbol: 'lodging',
    });
  });

  it('keeps an embedded comma inside a quoted field', () => {
    expect(file.waypoints[1]).toMatchObject({
      name: 'Spring, upper',
      description: 'Reliable, even in August',
    });
  });

  it('keeps an embedded newline inside a quoted field', () => {
    expect(file.waypoints[3]?.name).toBe('Multi\nline note');
  });

  it('leaves a blank elevation null, not 0', () => {
    const unknown = file.waypoints.find((w) => w.name === 'Unknown Height');
    expect(unknown?.ele).toBeNull();
    // The coordinates are still read, so the row is not lost over it.
    expect(unknown?.lat).toBe(45.9763);
  });

  it('leaves an absent time null', () => {
    expect(file.waypoints[0]?.time).toBeNull();
  });

  it('reads a semicolon-delimited file with non-standard headers', () => {
    const odd = readCsv(fixture('headers-odd.csv'), '/tmp/headers-odd.csv');

    expect(odd.waypoints).toHaveLength(2);
    expect(odd.waypoints[0]).toMatchObject({
      name: 'Pass Marker',
      lat: 46.5602,
      lon: 8.0431,
      ele: 2431,
      description: 'Top of the climb',
    });
  });

  it('reads a comma decimal separator in a semicolon-delimited file', () => {
    const european = readCsv(
      'Name;Lat;Lon;Alt\nGipfel;46,5602;8,0431;2431,5\n',
      '/tmp/de.csv',
    );
    expect(european.waypoints[0]).toMatchObject({
      lat: 46.5602,
      lon: 8.0431,
      ele: 2431.5,
    });
  });

  it('preserves an unrecognised column as metadata and reports it', () => {
    const extra = readCsv(
      'name,lat,lon,Difficulty\nPass,46.5,8.0,T3\n',
      '/tmp/extra.csv',
    );
    expect(extra.waypoints[0]?.metadata).toEqual({ Difficulty: 'T3' });
    expect(extra.unmappedMetadata).toContain('CSV column "Difficulty"');
  });

  it('numbers waypoints and warns when there is no name column', () => {
    const nameless = readCsv('lat,lon\n46.5,8.0\n', '/tmp/nameless.csv');
    expect(nameless.waypoints[0]?.name).toBe('Waypoint 1');
    expect(nameless.warnings.join(' ')).toMatch(/No name column/);
  });

  it('skips a row with an unparseable coordinate, naming it', () => {
    const broken = readCsv(
      'name,lat,lon\nGood,46.5,8.0\nBad,not-a-number,8.0\n',
      '/tmp/broken.csv',
    );
    expect(broken.waypoints).toHaveLength(1);
    expect(broken.skipped[0]).toMatchObject({ kind: 'waypoint', name: 'Bad' });
  });

  it('skips an out-of-range coordinate', () => {
    const broken = readCsv('name,lat,lon\nBad,146.5,8.0\n', '/tmp/range.csv');
    expect(broken.waypoints).toHaveLength(0);
    expect(broken.skipped[0]?.reason).toMatch(/out of range/);
  });

  it('warns rather than failing when only a header is present', () => {
    const header = readCsv('name,lat,lon\n', '/tmp/header.csv');
    expect(header.waypoints).toHaveLength(0);
    expect(header.warnings.join(' ')).toMatch(/no rows/);
  });

  it('refuses a file with no coordinate columns, naming the header', () => {
    try {
      readCsv('name,description\nA,B\n', '/tmp/nocoords.csv');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as Error).message).toMatch(/no latitude and longitude/);
      expect((error as ParseError).detail).toMatch(/name,description/);
    }
  });

  it('refuses an empty file', () => {
    expect(() => readCsv('', '/tmp/empty.csv')).toThrow(/empty/);
  });

  it('warns about an unreadable time rather than inventing one', () => {
    const odd = readCsv(
      'name,lat,lon,time\nA,46.5,8.0,not-a-date\n',
      '/tmp/time.csv',
    );
    expect(odd.waypoints[0]?.time).toBeNull();
    expect(odd.warnings.join(' ')).toMatch(/not a date/);
  });

  it('reads an ISO time', () => {
    const timed = readCsv(
      'name,lat,lon,time\nA,46.5,8.0,2026-07-14T06:30:00Z\n',
      '/tmp/timed.csv',
    );
    expect(timed.waypoints[0]?.time).toBe(Date.parse('2026-07-14T06:30:00Z'));
  });
});

// --------------------------------------------------------------------- write

describe('writeCsv', () => {
  it('writes the documented header', () => {
    expect(writeCsv([]).split('\r\n')[0]).toBe(CSV_COLUMNS.join(','));
  });

  it('writes an unknown elevation as an empty cell, not 0', () => {
    const output = writeCsv([
      {
        name: 'Flat',
        lat: 46.5,
        lon: 8,
        eleM: null,
        description: null,
        symbol: null,
      },
    ]);
    expect(output.split('\r\n')[1]).toBe('Flat,46.5,8,,,,');
  });

  it('quotes a field containing the delimiter or a newline', () => {
    const output = writeCsv([
      {
        name: 'Spring, upper',
        lat: 46,
        lon: 8,
        eleM: null,
        description: 'line\nbreak',
        symbol: null,
      },
    ]);
    expect(output).toContain('"Spring, upper"');
    expect(output).toContain('"line\nbreak"');
  });

  it('doubles an embedded quote', () => {
    const output = writeCsv([
      {
        name: 'say "hi"',
        lat: 46,
        lon: 8,
        eleM: null,
        description: null,
        symbol: null,
      },
    ]);
    expect(output).toContain('"say ""hi"""');
  });

  // A cell beginning = + - @ is evaluated as a formula by Excel and Sheets,
  // and imported file content is untrusted.
  it('neutralises a spreadsheet formula without losing the text', () => {
    const output = writeCsv([
      {
        name: '=HYPERLINK("http://x","click")',
        lat: 46,
        lon: 8,
        eleM: null,
        description: null,
        symbol: null,
      },
    ]);
    expect(output).toContain('"\t=HYPERLINK');

    const reread = readCsv(output, '/tmp/formula.csv');
    // The text survives intact; only the leading tab is trimmed off.
    expect(reread.waypoints[0]?.name).toBe('=HYPERLINK("http://x","click")');
  });

  it('writes full double precision', () => {
    const lat = 46.519712345678904;
    const output = writeCsv([
      {
        name: 'Precise',
        lat,
        lon: 8.012012345678901,
        eleM: null,
        description: null,
        symbol: null,
      },
    ]);
    expect(readCsv(output, '/tmp/precise.csv').waypoints[0]?.lat).toBe(lat);
  });
});

describe('CSV round trip', () => {
  it('returns the same waypoints, including the nulls', () => {
    const original = readCsv(fixture('waypoints.csv'), '/tmp/waypoints.csv');

    const output = writeCsv(
      original.waypoints.map((w) => ({
        name: w.name,
        lat: w.lat,
        lon: w.lon,
        eleM: w.ele,
        description: w.description,
        symbol: w.symbol,
        time: w.time,
      })),
    );

    const reread = readCsv(output, '/tmp/out.csv');

    expect(
      reread.waypoints.map((w) => [
        w.name,
        w.lat,
        w.lon,
        w.ele,
        w.description,
        w.symbol,
        w.time,
      ]),
    ).toEqual(
      original.waypoints.map((w) => [
        w.name,
        w.lat,
        w.lon,
        w.ele,
        w.description,
        w.symbol,
        w.time,
      ]),
    );
  });
});
