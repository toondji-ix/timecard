import { all, now, type Row } from './db';
import { dateAt, workedHours } from './domain';
export async function records(o: any, uid: string, isManager: boolean, q: URLSearchParams): Promise<Row[]> {
    const current = dateAt(now(), o.timezone), start = q.get('start') || current, end = q.get('end') || current;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000)
        throw Error('Choose a valid date range of up to one year.');
    let rows = await all(`SELECT a.*,u.name,u.email,m.department,l.name location_name FROM attendance a JOIN users u ON u.id=a.user_id JOIN memberships m ON m.user_id=a.user_id AND m.org_id=a.org_id LEFT JOIN locations l ON l.id=a.location_id WHERE a.org_id=? AND a.day>=? AND a.day<=? ${isManager ? '' : 'AND a.user_id=?'} ORDER BY a.day DESC,u.name`, o.id, start, end, ...(isManager ? [] : [uid]));
    const leaves = await all(`SELECT r.*,t.name leave_type FROM leave_requests r JOIN leave_types t ON t.id=r.type_id WHERE r.org_id=? AND r.status='approved' AND r.start<=? AND r.end>=? ${isManager ? '' : 'AND r.user_id=?'}`, o.id, end, start, ...(isManager ? [] : [uid]));
    const members = await all(`SELECT u.id user_id,u.name,u.email,m.department,substr(m.created,1,10) joined,substr(m.ended,1,10) ended FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=? ${isManager ? '' : 'AND u.id=?'}`, o.id, ...(isManager ? [] : [uid]));
    for (let t = Date.parse(start + 'T12:00:00Z'); t <= Date.parse(end + 'T12:00:00Z'); t += 86400000) {
        const d = new Date(t).toISOString().slice(0, 10);
        if (d > current || !JSON.parse(o.workdays).includes(new Date(t).getUTCDay()))
            continue;
        for (const p of members) {
            if (d < p.joined || (p.ended && d > p.ended) || rows.some(r => r.user_id === p.user_id && r.day === d))
                continue;
            const leave = leaves.find(l => l.user_id === p.user_id && l.start <= d && l.end >= d);
            rows.push({ ...p, id: `${p.user_id}-${d}`, day: d, status: leave ? 'on leave' : 'absent', leave_type: leave?.leave_type, notes: leave?.comment || '', check_in: null, check_out: null });
        }
    }
    const search = (q.get('search') || '').toLowerCase(), status = q.get('status'), department = q.get('department'), person = q.get('person');
    rows = rows.filter(r => (!search || `${r.name} ${r.email}`.toLowerCase().includes(search)) && (!status || r.status === status) && (!department || r.department === department) && (!person || r.user_id === person));
    return rows.sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name)).map(r => ({ ...r, total_hours: r.check_in ? workedHours(r.check_in, r.check_out || r.break_start, r.break_minutes) : 0 }));
}
