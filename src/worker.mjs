import {generateReport} from './src/report.mjs';
const json = (value, status = 200) => Response.json(value, {status, headers:{'Cache-Control':'no-store'}});
const error = (message, status) => json({error:message}, status);
const fields = "COALESCE(solicitante_nombre, (SELECT nombre FROM perfiles WHERE correo = viajes.solicitante_correo)) AS nombre_solicitante, folio, pasajero, pasajeros_adicionales, unidad, origen, destino, ida, regreso, COALESCE(comentarios_revision, notas) AS notas, vehiculo, CASE WHEN rechazado_en IS NULL THEN estado ELSE 'rechazado' END AS estado";
const vehicles = ['Taxi I','Taxi II','Taxi III','Taxi IV','Van'];
const roles = ['jefatura','coordinacion','consulta'];
const statuses = ['pendiente','confirmado','realizado','cancelado','rechazado'];

function chileNow() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone:'America/Santiago', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts();
  const partsByType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const {year,month,day,hour,minute} = partsByType;
  return year + '-' + month + '-' + day + 'T' + hour + ':' + minute;
}
function validTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  const date = new Date(value + ':00Z');
  return Number.isFinite(+date) && date.toISOString().startsWith(value);
}
async function list(db, params, role, id, email, fullAdmin) {
  const where = [];
  const values = [];
  if (!fullAdmin && role === 'jefatura') {
    where.push("(solicitante = ? OR solicitante_correo = ? OR (estado IN ('confirmado','realizado') AND pasajero_correo = ?))");
    values.push(id,email,email);
  }
  if (!fullAdmin && role === 'consulta') {
    where.push('(solicitante = ? OR solicitante_correo = ? OR pasajero_correo = ?)');
    values.push(id,email,email);
  }
  const state = params.get('estado');
  if (state === 'rechazado') where.push('rechazado_en IS NOT NULL');
  else if (statuses.includes(state)) {
    where.push('estado = ? AND rechazado_en IS NULL');
    values.push(state);
  }
  const day = params.get('fecha');
  if (day && validTime(day + 'T00:00')) { where.push('ida >= ? AND ida <= ?'); values.push(day+'T00:00',day+'T23:59'); }
  const folio = params.get('folio')?.trim().toUpperCase();
  if (folio) { where.push('instr(folio, ?) > 0'); values.push(folio.slice(0,40)); }
  const offset = Number(params.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return error('Página inválida.',400);
  const filter = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const order = state === 'pendiente' ? 'ida ASC, folio ASC' : 'ida DESC, folio DESC';
  const result = await db.prepare('SELECT '+fields+', pasajero_correo, solicitante, solicitante_correo FROM viajes'+filter+' ORDER BY '+order+' LIMIT 21 OFFSET ?').bind(...values,offset).all();
  const viajes = result.results.slice(0,20).map(({pasajero,pasajeros_adicionales,pasajero_correo,solicitante,solicitante_correo,...trip}) => {
    const canReport = fullAdmin || pasajero_correo === email || solicitante === id || solicitante_correo === email;
    return {
      ...trip, ...(fullAdmin ? {pasajero_correo} : {}),
      puede_confirmar_realizacion:pasajero_correo === email && trip.estado === 'confirmado',
      puede_ver_opcion_informe:canReport,
      puede_generar_informe:canReport && trip.estado === 'realizado',
      pasajeros:[pasajero,...JSON.parse(pasajeros_adicionales)]
    };
  });
  return json({viajes,next:result.results.length > 20 ? offset+20 : null});
}

function tripDetails(data) {
  const values = [];
  for (const [name,max] of Object.entries({pasajero:120,unidad:120,origen:220,destino:220,notas:500})) {
    const value = typeof data?.[name] === 'string' ? data[name].trim() : '';
    if ((!value && name !== 'notas') || value.length > max) return {message:'Revisa los datos del traslado.'};
    values.push(value);
  }
  const extra = data.pasajerosAdicionales ?? [];
  if (!Array.isArray(extra) || extra.length > 19 ||
      extra.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 120)) {
    return {message:'Revisa los nombres de los pasajeros adicionales.'};
  }
  const passengers = JSON.stringify(extra.map(name => name.trim()));
  const {ida,regreso} = data;
  if (!validTime(ida) || !validTime(regreso)) return {message:'Ingresa una fecha y hora válida para cada tramo.'};
  if (regreso <= ida) return {message:'El regreso debe ser posterior a la ida.'};
  return {values,passengers,ida,regreso};
}
async function availablePassengers(db, ownerEmail, ownerName) {
  const result = await db.prepare('SELECT correo, nombre, cargo FROM perfiles WHERE activo = 1 AND nombre IS NOT NULL').bind().all();
  const profiles = result.results;
  if (ownerName && !profiles.some(profile => profile.correo === ownerEmail)) {
    profiles.push({correo:ownerEmail,nombre:ownerName,cargo:'Administrador'});
  }
  return profiles.sort((a,b) => a.nombre.localeCompare(b.nombre,'es-CL') || a.correo.localeCompare(b.correo));
}
const regionalCommunes = [
  'Codegua','Coinco','Coltauco','Doñihue','Graneros','Las Cabras','Machalí','Malloa',
  'Mostazal','Olivar','Peumo','Pichidegua','Quinta de Tilcoco','Rancagua','Rengo','Requínoa','San Vicente',
  'Chépica','Chimbarongo','Lolol','Nancagua','Palmilla','Peralillo','Placilla','Pumanque','San Fernando','Santa Cruz',
  'La Estrella','Litueche','Marchigüe','Navidad','Paredones','Pichilemu'
];
const communeKey = name => name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
async function communes(db) {
  const result = await db.prepare('SELECT nombre FROM comunas_adicionales').bind().all();
  return [...regionalCommunes,...result.results.map(row => row.nombre)].sort((a,b) => a.localeCompare(b,'es-CL'));
}
async function addCommune(db, request) {
  const data = await request.json().catch(() => null);
  const name = typeof data?.nombre === 'string' ? data.nombre.trim().replace(/\s+/g,' ').normalize('NFC') : '';
  if (!name || name.length > 100 || !/^[\p{L}\p{M} .'’\-]+$/u.test(name) || !/\p{L}/u.test(name)) {
    return error('Ingresa un nombre de comuna válido.',400);
  }
  const key = communeKey(name);
  if (regionalCommunes.some(commune => communeKey(commune) === key)) return error('La comuna ya está en la lista.',409);
  const result = await db.prepare('INSERT INTO comunas_adicionales (clave,nombre) VALUES (?,?) ON CONFLICT(clave) DO NOTHING').bind(key,name).run();
  return result.meta.changes ? json({nombre:name},201) : error('La comuna ya está en la lista.',409);
}
async function create(db, request, id, name, ownerEmail, ownerName) {
  const data = await request.json().catch(() => null);
  const details = tripDetails(data);
  if (details.message) return error(details.message,400);
  const {values,passengers,ida,regreso} = details;
  if (ida < chileNow()) return error('La ida debe programarse a partir de la hora actual.',400);
  if (typeof data.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(data.requestId)) return error('Identificador de solicitud inválido.',400);
  const folio = 'TX-' + data.requestId.toUpperCase();
  const availableCommunes = await communes(db);
  if (!availableCommunes.includes(values[2])) return error('Selecciona una comuna de origen de la lista.',400);
  if (!availableCommunes.includes(values[3])) return error('Selecciona una comuna de destino de la lista.',400);
  const profiles = await availablePassengers(db,ownerEmail,ownerName);
  const selected = profiles.find(profile => profile.correo === normalizedEmail(data.pasajero_correo));
  if (!selected || selected.nombre !== values[0] ||
      !JSON.parse(passengers).every(passenger => profiles.some(profile => profile.nombre === passenger))) {
    return error('Selecciona un pasajero válido de la lista de perfiles activos.',400);
  }
  const {meta} = await db.prepare('INSERT INTO viajes (folio,solicitante,pasajero,unidad,origen,destino,notas,ida,regreso,pasajeros_adicionales,solicitante_nombre,pasajero_correo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(folio) DO NOTHING')
    .bind(folio,id,...values,ida,regreso,passengers,name,selected.correo).run();
  if (!meta.changes) {
    const old = await db.prepare('SELECT solicitante,pasajero,unidad,origen,destino,notas,ida,regreso,pasajeros_adicionales,pasajero_correo FROM viajes WHERE folio = ?').bind(folio).first();
    if (!old || old.solicitante !== id || old.pasajero_correo !== selected.correo || ![old.pasajero,old.unidad,old.origen,old.destino,old.notas,old.ida,old.regreso,old.pasajeros_adicionales].every((value,i) => value === [...values,ida,regreso,passengers][i])) {
      return error('El folio corresponde a una solicitud diferente.',409);
    }
    return json({folio});
  }
  return json({folio},201);
}
async function change(db, request, folio, role, email, fullAdmin) {
  const data = await request.json().catch(() => null);
  const next = data?.estado;
  const decision = ['confirmado','rechazado','reasignar','editar'].includes(next);
  const close = ['cancelado','realizado'].includes(next);
  const passengerCompletion = next === 'realizado' && !fullAdmin;
  if ((decision && role !== 'coordinacion' && !fullAdmin) || (close && !fullAdmin && !passengerCompletion) || (!decision && !close)) {
    return error('Tu perfil no permite esta acción.',403);
  }
  if (['confirmado','reasignar'].includes(next) && !vehicles.includes(data.vehiculo)) {
    return error('Selecciona un vehículo de la lista.',400);
  }
  if (next === 'editar' && data.vehiculo !== null && !vehicles.includes(data.vehiculo)) {
    return error('Selecciona un vehículo válido.',400);
  }
  const hasComments = decision && Object.hasOwn(data,'comentarios');
  if (hasComments && (typeof data.comentarios !== 'string' || data.comentarios.trim().length > 500)) {
    return error('Los comentarios deben tener hasta 500 caracteres.',400);
  }
  let update;
  let predicate;
  let parameters = [];
  if (next === 'rechazado') {
    update = 'rechazado_en = CURRENT_TIMESTAMP';
    predicate = "estado = 'pendiente'";
  } else if (decision) {
    update = next === 'confirmado' ? "estado = 'confirmado', vehiculo = ?" : 'vehiculo = ?';
    predicate = next === 'confirmado' ? "estado = 'pendiente'" : "estado = 'confirmado'";
    if (next === 'editar') {
      predicate = data.vehiculo === null ? "estado = 'pendiente' OR (estado = 'confirmado' AND vehiculo IS NULL)" : "estado IN ('pendiente','confirmado')";
    }
    parameters = [data.vehiculo];
  } else {
    update = 'estado = ?';
    predicate = "estado IN ('pendiente','confirmado')";
    parameters = [next];
  }
  if (hasComments) {
    update += ', comentarios_revision = ?';
    parameters.push(data.comentarios.trim());
  }
  const scope = [];
  if (passengerCompletion) {
    predicate = "estado = 'confirmado' AND pasajero_correo = ?";
    scope.push(email);
  }
  if (next === 'realizado' && fullAdmin) predicate = "estado = 'confirmado'";
  const result = await db.prepare('UPDATE viajes SET '+update+', actualizado = CURRENT_TIMESTAMP, actualizado_por = ? WHERE folio = ? AND rechazado_en IS NULL AND ('+predicate+')')
    .bind(...parameters,email,folio,...scope).run();
  const estado = next === 'reasignar' ? 'confirmado' : next;
  if (result.meta.changes) return next === 'editar' ? json({guardado:true}) : json({estado});
  const trip = await db.prepare("SELECT CASE WHEN rechazado_en IS NULL THEN estado ELSE 'rechazado' END AS estado, vehiculo, comentarios_revision FROM viajes WHERE folio = ?"+(passengerCompletion ? ' AND pasajero_correo = ?' : ''))
    .bind(folio,...(passengerCompletion ? [email] : [])).first();
  if (!trip) return error('Viaje no encontrado.',404);
  if (trip.estado === estado && (!['confirmado','reasignar'].includes(next) || trip.vehiculo === data.vehiculo) &&
      (!hasComments || trip.comentarios_revision === data.comentarios.trim())) return json({estado});
  return error('El viaje cambió de estado o todavía no está aceptado.',409);
}

async function manageTrip(db, request, folio, email, ownerEmail, ownerName) {
  if (request.method === 'DELETE') {
    const result = await db.prepare('DELETE FROM viajes WHERE folio = ?').bind(folio).run();
    return result.meta.changes ? json({eliminado:true}) : error('Viaje no encontrado.',404);
  }
  const data = await request.json().catch(() => null);
  const details = tripDetails(data);
  if (details.message) return error(details.message,400);
  const {values,passengers,ida,regreso} = details;
  if (data.vehiculo !== null && !vehicles.includes(data.vehiculo)) {
    return error('Selecciona un vehículo válido.',400);
  }
  const [pasajero,unidad,origen,destino,comentarios] = values;
  const passengerEmail = normalizedEmail(data.pasajero_correo);
  if (passengerEmail) {
    const profiles = await availablePassengers(db,ownerEmail,ownerName);
    if (!profiles.some(profile => profile.correo === passengerEmail && profile.nombre === pasajero)) {
      const prior = await db.prepare('SELECT pasajero, pasajero_correo FROM viajes WHERE folio = ?').bind(folio).first();
      if (prior?.pasajero_correo !== passengerEmail || prior.pasajero !== pasajero) {
        return error('Selecciona un perfil que coincida con el pasajero principal.',400);
      }
    }
  }
  const result = await db.prepare('UPDATE viajes SET pasajero = ?, pasajero_correo = ?, unidad = ?, origen = ?, destino = ?, comentarios_revision = ?, pasajeros_adicionales = ?, ida = ?, regreso = ?, vehiculo = ?, actualizado = CURRENT_TIMESTAMP, actualizado_por = ? WHERE folio = ? AND (vehiculo IS NULL OR ? IS NOT NULL OR estado <> ?)')
    .bind(pasajero,passengerEmail || null,unidad,origen,destino,comentarios,passengers,ida,regreso,data.vehiculo,email,folio,data.vehiculo,'confirmado').run();
  return result.meta.changes ? json({guardado:true}) : error('Verifica que el viaje exista y que los viajes aceptados tengan vehículo.',409);
}
async function manageProfiles(db, request, url, ownerEmail, owner) {
  if (request.method === 'GET') {
    const search = (url.searchParams.get('correo') || '').trim().toLowerCase().slice(0,254);
    const result = await db.prepare('SELECT correo,nombre,cargo,rol,activo,administrador_general FROM perfiles WHERE correo <> ? AND instr(correo, ?) > 0 ORDER BY correo LIMIT 26')
      .bind(ownerEmail,search).all();
    return json({
      perfiles:result.results.slice(0,25).map(profile => ({
        ...profile, editable:owner || profile.administrador_general === 0,
        eliminable:owner || profile.administrador_general === 0
      })),
      mas:result.results.length > 25
    });
  }
  if (!['POST','PATCH','DELETE'].includes(request.method)) return error('Método no permitido.',405);
  const data = await request.json().catch(() => null);
  const correo = typeof data?.correo === 'string' ? data.correo.trim().toLowerCase() : '';
  const cargo = typeof data?.cargo === 'string' ? data.cargo.trim() : '';
  const rol = data?.rol;
  if (correo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return error('Ingresa un correo válido.',400);
  }
  if (correo === ownerEmail) return error('La cuenta propietaria se administra en la configuración del portal.',403);
  if (request.method === 'DELETE') {
    const result = await db.prepare('DELETE FROM perfiles WHERE correo = ? AND (? = 1 OR administrador_general = 0)')
      .bind(correo,+owner).run();
    return result.meta.changes ? json({eliminado:true}) : error('El perfil no existe o está reservado a la cuenta propietaria.',404);
  }
  if (!cargo || cargo.length > 120 || !roles.includes(rol)) {
    return error('Ingresa el cargo y selecciona un rol válido.',400);
  }
  const nombre = typeof data.nombre === 'string' ? data.nombre.trim() : '';
  if (!nombre || nombre.length > 120) return error('Ingresa el nombre completo de la persona.',400);
  const active = data.activo ?? true;
  const general = data.administrador_general ?? false;
  if (typeof active !== 'boolean' || typeof general !== 'boolean') return error('Los permisos del perfil no son válidos.',400);
  if (general && !owner) return error('Tu cuenta no puede otorgar ese permiso de administración.',403);
  if (request.method === 'POST') {
    const result = await db.prepare('INSERT INTO perfiles (correo,nombre,cargo,rol,activo,administrador_general) VALUES (?,?,?,?,?,?) ON CONFLICT(correo) DO NOTHING')
      .bind(correo,nombre,cargo,rol,+active,+general).run();
    if (!result.meta.changes) return error('Ya existe un perfil para este correo.',409);
    return json({correo,nombre,cargo,rol},201);
  }
  const result = await db.prepare('UPDATE perfiles SET nombre = ?, cargo = ?, rol = ?, activo = ?, administrador_general = ? WHERE correo = ? AND (? = 1 OR administrador_general = 0)')
    .bind(nombre,cargo,rol,+active,+general,correo,+owner).run();
  if (!result.meta.changes) {
    return error('El perfil no existe o está reservado a la cuenta propietaria.',404);
  }
  return json({correo,nombre,cargo,rol});
}
const normalizedEmail = value => String(value ?? '').trim().toLowerCase();
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
async function tripReport(db, request, folio, id, email, name, fullAdmin) {
  const trip = await db.prepare("SELECT pasajero, pasajero_correo, unidad, ida, regreso, destino FROM viajes WHERE folio = ? AND (pasajero_correo = ? OR solicitante = ? OR solicitante_correo = ? OR ? = 1) AND estado = 'realizado' AND rechazado_en IS NULL")
    .bind(folio,email,id,email,+fullAdmin).first();
  if (!trip) return error('El informe está disponible para viajes realizados vinculados a tu cuenta.',404);
  const result = await db.prepare("SELECT DISTINCT nombre FROM perfiles WHERE activo = 1 AND nombre IS NOT NULL AND rol = 'jefatura' ORDER BY nombre").bind().all();
  const jefaturas = result.results.map(profile => profile.nombre);
  const funcionario = trip.pasajero_correo === email ? name || trip.pasajero : trip.pasajero;
  const jefaturaManual = jefaturas.length === 0;
  const fechaRendicion = chileNow().slice(0,10);
  if (request.method === 'GET') {
    const units = await db.prepare('SELECT DISTINCT unidad FROM viajes WHERE pasajero_correo = ? ORDER BY unidad LIMIT 100').bind(trip.pasajero_correo).all();
    return json({jefaturas,jefaturaManual,
      unidades:[...new Set([trip.unidad,...units.results.map(row => row.unidad)])],
      funcionario, unidad:trip.unidad, fechaRendicion
    });
  }
  return await reportDownload(request,trip,{folio,funcionario,jefaturas,jefaturaManual});
}
async function demoReport(request, selectedFolio) {
  const folio = selectedFolio || 'DEMO-001';
  if (!['DEMO-001','DEMO-002'].includes(folio)) return error('Viaje de muestra no disponible.',404);
  const secondTrip = folio === 'DEMO-002';
  const fechaRendicion = chileNow().slice(0,10);
  const day = new Date(fechaRendicion+'T00:00:00Z');
  day.setUTCDate(day.getUTCDate()-(secondTrip ? 2 : 5));
  const fecha = day.toISOString().slice(0,10);
  const trip = {ida:fecha+'T09:30',regreso:fecha+'T12:00',destino:secondTrip ? 'Santa Cruz' : 'Paredones'};
  const funcionario = 'Visualizador de prueba';
  const jefaturas = ['Jefatura de ejemplo'];
  if (request.method === 'GET') return json({
    funcionario,jefaturas,unidades:['Unidad de ejemplo'],unidad:'Unidad de ejemplo',fechaRendicion,
    demo:true,rut:'12.345.678-5',folioCometido:folio,observaciones:'Ejemplo ficticio de labores desarrolladas durante un traslado institucional.'
  });
  return await reportDownload(request,trip,{folio:'muestra',funcionario,jefaturas,demo:true});
}
async function reportDownload(request, trip, options) {
  const input = await request.json().catch(() => null);
  const data = {};
  const limits = {rut:15, unidad:120, folio:100, jefatura:120, resolucion:120, proyecto:160, observaciones:1500};
  for (const [key,max] of Object.entries(limits)) {
    data[key] = typeof input?.[key] === 'string' ? input[key].trim() : '';
    if (data[key].length > max || (!data[key] && !['resolucion','proyecto'].includes(key))) {
      return error('Completa los datos obligatorios del informe y revisa la longitud de los campos.',400);
    }
  }
  const rut = data.rut.replace(/[.\s-]/g,'').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(rut)) return error('Ingresa el RUT y su dígito verificador.',400);
  data.rut = rut.slice(0,-1)+'-'+rut.slice(-1);
  data.fechaResolucion = input?.fechaResolucion || '';
  data.fechaRendicion = input?.fechaRendicion || '';
  if (!validTime(data.fechaRendicion+'T00:00') ||
      (data.fechaResolucion && !validTime(data.fechaResolucion+'T00:00'))) return error('Revisa las fechas del informe.',400);
  if (!options.jefaturaManual && !options.jefaturas.includes(data.jefatura)) {
    return error('Selecciona una jefatura activa de la lista.',400);
  }
  const pdf = await generateReport(trip,{...data,funcionario:options.funcionario,demo:options.demo},REPORT_LOGO);
  return new Response(pdf,{headers:{
    'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="informe-cometido-'+options.folio+'.pdf"',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
  }});
}
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(text) ? "'"+text : text;
  return '"'+safe.replaceAll('"','""')+'"';
}
async function exportTrips(db, params) {
  if (params.get('opciones') === '1') {
    const saved = await db.prepare('SELECT DISTINCT destino FROM viajes ORDER BY destino').bind().all();
    const destinations = new Set([...await communes(db),...saved.results.map(row => row.destino)]);
    return json({destinos:[...destinations].sort((a,b) => a.localeCompare(b,'es-CL'))});
  }
  const from = params.get('desde') || '';
  const to = params.get('hasta') || '';
  const vehicle = params.get('vehiculo') || '';
  const destination = params.get('destino') || '';
  if ((from && !validTime(from+'T00:00')) || (to && !validTime(to+'T23:59')) || (from && to && from > to)) {
    return error('Revisa el rango de fechas de ida.',400);
  }
  if (vehicle && !vehicles.includes(vehicle)) return error('Selecciona un vehículo válido.',400);
  if (destination.length > 220) return error('Selecciona un destino válido.',400);
  const terms = [];
  const args = [];
  if (from) { terms.push('ida >= ?'); args.push(from+'T00:00'); }
  if (to) { terms.push('ida <= ?'); args.push(to+'T23:59'); }
  if (vehicle) { terms.push('vehiculo = ?'); args.push(vehicle); }
  if (destination) { terms.push('destino = ?'); args.push(destination); }
  const where = terms.length ? ' WHERE '+terms.join(' AND ') : '';
  const result = await db.prepare('SELECT '+fields+' FROM viajes'+where+' ORDER BY ida DESC, folio DESC LIMIT 5001').bind(...args).all();
  if (result.results.length > 5000) return error('Acota los filtros para exportar hasta 5.000 viajes por archivo.',400);
  const labels = {pendiente:'Pendiente',confirmado:'Aceptado',rechazado:'Rechazado',realizado:'Realizado',cancelado:'Cancelado'};
  const rows = [['Folio','Solicitante','Pasajeros','Unidad','Origen','Destino','Ida','Regreso','Vehículo','Estado']];
  for (const trip of result.results) {
    rows.push([trip.folio,trip.nombre_solicitante,[trip.pasajero,...JSON.parse(trip.pasajeros_adicionales)].join(' | '),
      trip.unidad,trip.origen,trip.destino,trip.ida.replace('T',' '),trip.regreso.replace('T',' '),trip.vehiculo,labels[trip.estado]]);
  }
  return new Response('\uFEFF'+rows.map(row => row.map(csvCell).join(';')).join('\r\n')+'\r\n',{headers:{
    'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="viajes.csv"',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
  }});
}
async function importRecords(db, request, ownerEmail) {
  const data = await request.json().catch(() => null);
  const rows = data?.filas;
  if (!['viajes','perfiles'].includes(data?.tipo) || !Array.isArray(rows) || rows.length < 1 || rows.length > 40) {
    return error('Selecciona una plantilla válida con 1 a 40 filas.',400);
  }
  const statements = [];
  const seen = new Set();
  const problems = [];
  for (const [index,row] of rows.entries()) {
    const line = 'Fila de datos '+(index+1)+': ';
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      problems.push(line+'registro inválido.');
      continue;
    }
    if (data.tipo === 'perfiles') {
      const correo = normalizedEmail(row.correo);
      const nombre = typeof row.nombre === 'string' ? row.nombre.trim() : '';
      const cargo = typeof row.cargo === 'string' ? row.cargo.trim() : '';
      const roleName = typeof row.rol === 'string' ? row.rol.trim().toLowerCase() : '';
      const rol = new Map([['solicitante','jefatura'],['coordinador','coordinacion'],['usuario','consulta'],['visualizador','consulta']]).get(roleName) || roleName;
      const activo = String(row.activo ?? '').trim() || '1';
      if (!validEmail(correo) || correo === ownerEmail || nombre.length > 120 || !cargo || cargo.length > 120 || !roles.includes(rol) || !['0','1'].includes(activo) || seen.has(correo)) {
        problems.push(line+'revisa correo, nombre, cargo, rol y activo, y evita correos repetidos.');
        continue;
      }
      seen.add(correo);
      statements.push(db.prepare('INSERT INTO perfiles (correo,nombre,cargo,rol,activo) VALUES (?,?,?,?,?) ON CONFLICT(correo) DO NOTHING')
        .bind(correo,nombre || null,cargo,rol,+activo));
      continue;
    }
    const name = typeof row.nombre_solicitante === 'string' ? row.nombre_solicitante.trim() : '';
    const ref = String(row.id_externo ?? '').trim();
    const correo = normalizedEmail(row.correo_solicitante);
    const vehiculo = String(row.vehiculo ?? '').trim() || null;
    const estado = String(row.estado ?? '').trim().toLowerCase() || 'pendiente';
    const pasajerosAdicionales = String(row.pasajeros_adicionales ?? '').split('|').map(name => name.trim()).filter(Boolean);
    const details = tripDetails({...row,pasajerosAdicionales});
    if (name.length > 120 || !ref || ref.length > 120 || seen.has(ref) || !validEmail(correo) || !statuses.includes(estado) ||
        (vehiculo !== null && !vehicles.includes(vehiculo)) || (estado === 'confirmado' && !vehiculo) || details.message) {
      problems.push(line+(details.message || 'revisa el ID externo, correo y nombre del solicitante, vehículo y estado.'));
      continue;
    }
    seen.add(ref);
    const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode('viajes-importados:'+ref));
    const folio = 'TX-'+Array.from(new Uint8Array(hash).slice(0,16), byte => byte.toString(16).padStart(2,'0')).join('').toUpperCase();
    const {values,passengers,ida,regreso} = details;
    statements.push(db.prepare('INSERT INTO viajes (folio,solicitante,solicitante_correo,pasajero,unidad,origen,destino,notas,ida,regreso,pasajeros_adicionales,vehiculo,estado,solicitante_nombre,rechazado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN CURRENT_TIMESTAMP END) ON CONFLICT(folio) DO NOTHING')
      .bind(folio,'',correo,...values,ida,regreso,passengers,vehiculo,estado === 'rechazado' ? 'pendiente' : estado,name || null,+(estado === 'rechazado')));
  }
  if (problems.length) return json({error:problems.join(' ')},400);
  const results = await db.batch(statements);
  const imported = results.reduce((sum,result) => sum+result.meta.changes,0);
  return json({importados:imported,omitidos:rows.length-imported});
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(PAGE,{headers:{
        'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"
      }});
    }
    if (!url.pathname.startsWith('/api/')) return error('Ruta no encontrada.',404);
    const id = request.headers.get('oai-authenticated-user-id');
    const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
    if (!id || !email) return error('Inicia sesión para continuar.',401);
    if (request.method !== 'GET' && (request.headers.get('origin') !== url.origin || request.headers.get('content-type')?.split(';')[0] !== 'application/json')) {
      return error('Origen de solicitud inválido.',403);
    }
    const db = env.DB;
    try {
      const profile = await db.prepare('SELECT nombre, cargo, rol, activo, administrador_general FROM perfiles WHERE correo = ?').bind(email).first();
      let signedName = request.headers.get('oai-authenticated-user-full-name') || '';
      if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
        try { signedName = decodeURIComponent(signedName); } catch { signedName = ''; }
      }
      const name = profile?.nombre || signedName.trim().slice(0,120) || null;
      const ownerEmail = env.PROFILE_ADMIN_EMAIL?.trim().toLowerCase() || '';
      const owner = email === ownerEmail;
      const ownerRole = roles.includes(env.PROFILE_ADMIN_TRAVEL_ROLE) ? env.PROFILE_ADMIN_TRAVEL_ROLE : null;
      const role = owner && ownerRole ? ownerRole :
        profile?.activo === 1 && roles.includes(profile.rol) ? profile.rol : null;
      const fullAdmin = owner ? ownerRole !== 'consulta' :
        profile?.activo === 1 && profile.administrador_general === 1;
      if (url.pathname === '/api/exportar-viajes' && request.method === 'GET') {
        return fullAdmin || role === 'coordinacion' ? await exportTrips(db,url.searchParams) : error('Tu perfil no puede exportar viajes.',403);
      }
      if (url.pathname === '/api/exportar-proyecto' && request.method === 'GET') {
        if (!fullAdmin) return error('Tu cuenta no puede exportar el proyecto.',403);
        if (!PROJECT_ARCHIVE) return error('La exportación no está disponible.',404);
        const bytes = Uint8Array.from(atob(PROJECT_ARCHIVE), char => char.charCodeAt(0));
        return new Response(bytes,{headers:{
          'Content-Type':'application/zip','Content-Disposition':'attachment; filename="portal-traslados-cloudflare.zip"',
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
        }});
      }
      if (url.pathname === '/api/importar' && request.method === 'POST') {
        return fullAdmin ? await importRecords(db,request,ownerEmail) : error('Tu cuenta no puede realizar cargas masivas.',403);
      }
      if (url.pathname === '/api/perfiles') {
        return fullAdmin ? await manageProfiles(db,request,url,ownerEmail,owner) : error('Tu cuenta no puede administrar perfiles.',403);
      }
      if (url.pathname === '/api/perfil' && request.method === 'GET') {
        const cargo = role ? profile?.cargo : undefined;
        return json({email,nombre:name,cargo,rol:role,canManageProfiles:fullAdmin,canGrantFullAdmin:owner && fullAdmin,fullAdmin,canExport:fullAdmin && Boolean(PROJECT_ARCHIVE),vehiculos:role === 'coordinacion' || fullAdmin ? vehicles : undefined,now:chileNow()});
      }
      if (!role && !fullAdmin) return error('Tu cuenta requiere un perfil activo.',403);
      const canRegister = role === 'jefatura' || fullAdmin;
      if (url.pathname === '/api/comunas') {
        if (request.method === 'GET' && canRegister) return json({comunas:await communes(db)});
        if (request.method === 'POST' && fullAdmin) return await addCommune(db,request);
        return error('Tu perfil no puede realizar esta acción.',403);
      }
      if (url.pathname === '/api/pasajeros' && request.method === 'GET') {
        if (!canRegister) return error('Tu perfil no puede consultar la lista de pasajeros.',403);
        return json({pasajeros:await availablePassengers(db,ownerEmail,owner ? name : null)});
      }
      if (url.pathname === '/api/viajes' && request.method === 'GET') return await list(db,url.searchParams,role,id,email,fullAdmin);
      if (url.pathname === '/api/viajes' && request.method === 'POST') {
        return canRegister ? await create(db,request,id,name,ownerEmail,owner ? name : null) : error('Tu perfil no puede registrar viajes.',403);
      }
      if (url.pathname === '/api/informe-de-prueba' && ['GET','POST'].includes(request.method)) {
        return fullAdmin ? await demoReport(request,url.searchParams.get('folio')) : error('La muestra del informe está reservada a Administradores.',403);
      }
      const report = url.pathname.match(/^\/api\/viajes\/(TX-[A-F0-9]{32})\/informe$/);
      if (report && ['GET','POST'].includes(request.method)) return await tripReport(db,request,report[1],id,email,name,fullAdmin);
      const match = url.pathname.match(/^\/api\/viajes\/(TX-[A-F0-9]{32})$/);
      if (match && request.method === 'PATCH') return await change(db,request,match[1],role,email,fullAdmin);
      const adminTrip = url.pathname.match(/^\/api\/admin\/viajes\/(TX-[A-F0-9]{32})$/);
      if (adminTrip && ['PATCH','DELETE'].includes(request.method)) {
        return fullAdmin ? await manageTrip(db,request,adminTrip[1],email,ownerEmail,owner ? name : null) : error('Tu cuenta no puede administrar viajes.',403);
      }
      return error('Ruta no encontrada.',404);
    } catch (cause) {
      console.error('Portal request failed',cause.name);
      return error('No pudimos completar la operación. Inténtalo nuevamente.',503);
    }
  }
};
