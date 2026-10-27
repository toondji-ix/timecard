import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters,workedHours,dateAt,minutesAt,leaveDays,safeCsv } from '../lib/domain.ts';
test('geofencing uses metres and crosses the date line correctly',()=>{assert.equal(distanceMeters({lat:6.5244,lng:3.3792},{lat:6.5244,lng:3.3792}),0);const meters=distanceMeters({lat:0,lng:0},{lat:0,lng:.001});assert.ok(meters>111&&meters<112);assert.ok(distanceMeters({lat:0,lng:179.999},{lat:0,lng:-179.999})<223);});
test('work duration subtracts breaks and never becomes negative',()=>{assert.equal(workedHours('2026-10-26T08:00:00Z','2026-10-26T16:30:00Z',30),8);assert.equal(workedHours('2026-10-26T08:00:00Z','2026-10-26T08:01:00Z',30),0);});
test('workspace dates and late thresholds use the organization timezone',()=>{assert.equal(dateAt('2026-10-26T23:30:00Z','Africa/Lagos'),'2026-10-27');assert.equal(minutesAt('2026-10-26T08:11:00Z','Africa/Lagos'),551);});
test('leave counts working days including both endpoints',()=>{assert.equal(leaveDays('2026-10-23','2026-10-26'),2);assert.equal(leaveDays('2026-10-24','2026-10-25'),0);assert.equal(leaveDays('2026-10-24','2026-10-25',[0,6]),2);});
test('CSV escapes quotes and prevents formula injection',()=>{assert.equal(safeCsv('Ada "A"'),'"Ada ""A"""');assert.equal(safeCsv('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');assert.equal(safeCsv(null),'""');});
