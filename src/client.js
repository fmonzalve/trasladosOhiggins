const get = id => document.getElementById(id);
const register = get('register');
const filters = get('filters');
const profileForm = get('profiles-form');
const dialog = get('review');
const states = {pendiente:'Pendiente',confirmado:'Aceptado',rechazado:'Rechazado',realizado:'Realizado',cancelado:'Cancelado'};
const profiles = {jefatura:'Solicitante',coordinacion:'Coordinador',consulta:'Visualizador',administrador:'Administrador'};
const copy = {
  registrar:['Registrar viaje','Completa los datos del traslado y revisa la solicitud antes de registrarla.'],
  visualizar:['Visualizar viajes','Consulta el estado de las solicitudes y busca por folio, fecha o estado.'],
  visualizador:['Visualizador','Consulta los viajes registrados y filtra por folio, fecha o estado.'],
  confirmar:['Confirmar viajes','Revisa el vehículo y los comentarios antes de validar o rechazar una solicitud.'],
  perfiles:['Administrar perfiles','Crea perfiles y modifica el cargo, el perfil o el estado de acceso.'],
  importar:['Carga masiva','Importa viajes históricos o perfiles desde una plantilla CSV.']
};
let session;
let liveSession;
const completedPreviewTrips = new Set();
let view;
let offset = 0;
let nextOffset;
let filterParams;
let loadId = 0;
let draft;
let draftKey;
let dialogAction;
function node(tag, text, className) {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
}
async function api(path, method = 'GET', body) {
  if (liveSession && path.split('?')[0] !== 'informe-de-prueba') throw new Error('Sal de la vista previa para acceder a los datos del portal.');
  const response = await fetch('/api/' + path,{
    method, headers:{'Content-Type':'application/json'},
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No pudimos completar la operación.');
  return result;
}
function show(text, failed = false) {
  get('feedback').textContent = text;
  get('feedback').className = failed ? 'feedback error' : 'feedback';
}
function dateLabel(value) {
  const [day,time] = value.split('T');
  return day.split('-').reverse().join('/') + ' · ' + time;
}
function openDialog(title, text, label, action) {
  get('review-title').textContent = title;
  get('summary').textContent = text;
  get('summary').hidden = !text;
  get('dialog-fields').replaceChildren();
  get('save').textContent = label;
  get('dialog-feedback').textContent = '';
  dialogAction = action;
  dialog.showModal();
}
get('dismiss').addEventListener('click',() => dialog.close());
dialog.addEventListener('cancel',event => {
  if (get('save').disabled) event.preventDefault();
});
get('save').addEventListener('click',async () => {
  get('save').disabled = true;
  get('dismiss').disabled = true;
  try {
    const message = await dialogAction();
    if (message === undefined) return;
    dialog.close();
    show(message);
  } catch (failure) {
    get('dialog-feedback').textContent = failure.message;
  } finally {
    get('save').disabled = false;
    get('dismiss').disabled = false;
  }
});
async function editTrip(trip) {
  let profiles;
  try {
    profiles = (await api('pasajeros')).pasajeros;
  } catch (failure) {
    show(failure.message,true);
    return;
  }
  const form = node('form','','grid');
  const add = (title,name,value,type,max) => {
    const label = node('label',title);
    const field = node(type === 'textarea' || type === 'select' ? type : 'input','');
    if (field.tagName === 'INPUT') field.type = type;
    field.name = name;
    if (type === 'select') {
      for (const vehicle of ['',...session.vehiculos]) {
        const option = node('option',vehicle || 'Sin vehículo');
        option.value = vehicle;
        field.append(option);
      }
    }
    if (max) field.maxLength = max;
    field.required = !['notas','vehiculo'].includes(name);
    field.value = value || '';
    label.append(field);
    form.append(label);
  };
  add('Pasajeros (uno por línea)','pasajeros',trip.pasajeros.join('\n'),'textarea',2420);
  const linkLabel = node('label','Cuenta del pasajero principal');
  const link = node('select','');
  const none = node('option','Sin cuenta vinculada');
  none.value = '';
  link.append(none);
  for (const profile of profiles) {
    const option = node('option',profile.nombre+' · '+profile.correo);
    option.value = profile.correo;
    link.append(option);
  }
  if (trip.pasajero_correo && !profiles.some(profile => profile.correo === trip.pasajero_correo)) {
    const prior = node('option',trip.pasajero_correo+' · Perfil no disponible');
    prior.value = trip.pasajero_correo;
    link.append(prior);
  }
  link.value = trip.pasajero_correo || '';
  linkLabel.append(link);
  form.append(linkLabel);
  add('Unidad','unidad',trip.unidad,'text',120);
  add('Origen','origen',trip.origen,'text',220);
  add('Destino','destino',trip.destino,'text',220);
  add('Ida','ida',trip.ida,'datetime-local');
  add('Regreso','regreso',trip.regreso,'datetime-local');
  add('Vehículo','vehiculo',trip.vehiculo,'select');
  add('Comentarios','notas',trip.notas,'textarea',500);
  form.addEventListener('submit',event => event.preventDefault());
  openDialog('Editar viaje','','Guardar viaje',async () => {
    if (!form.reportValidity()) return;
    const {pasajeros,vehiculo,...details} = Object.fromEntries(new FormData(form));
    const [writtenName,...pasajerosAdicionales] = pasajeros.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
    const pasajero = profiles.find(profile => profile.correo === link.value)?.nombre || writtenName;
    await api('admin/viajes/'+trip.folio,'PATCH',{...details,pasajero,pasajero_correo:link.value,pasajerosAdicionales,vehiculo:vehiculo || null});
    await load();
    return 'Viaje actualizado.';
  });
  get('dialog-fields').append(form);
  form.elements.pasajeros.focus();
}
async function openTripReport(trip) {
  const endpoint = liveSession ? 'informe-de-prueba?folio='+encodeURIComponent(trip.folio) : 'viajes/'+trip.folio+'/informe';
  let report;
  try {
    report = await api(endpoint);
  } catch (failure) {
    show(failure.message,true);
    return;
  }
  if (!report.jefaturas.length && !report.jefaturaManual) {
    show('Para generar el informe, el Administrador debe registrar al menos una jefatura activa con nombre completo.',true);
    return;
  }
  const form = node('form','','grid report-form');
  function field(title, name, type, initial = '', max, required = true) {
    const label = node('label',title);
    const control = node(['select','textarea'].includes(type) ? type : 'input','');
    if (control.tagName === 'INPUT') control.type = type;
    control.name = name;
    control.required = required;
    control.value = initial;
    if (max) control.maxLength = max;
    label.append(control);
    form.append(label);
    return control;
  }
  const person = field('Nombre del funcionario','funcionario','text',report.funcionario);
  person.readOnly = true;
  const rut = field('RUT del funcionario','rut','text',report.rut || '',15);
  rut.placeholder = '12.345.678-9';
  const unit = field('Unidad de dependencia','unidad','text',report.unidad,120);
  const units = node('datalist','');
  units.id = 'report-units';
  unit.setAttribute('list',units.id);
  for (const name of report.unidades) {
    const option = node('option','');
    option.value = name;
    units.append(option);
  }
  form.append(units);
  if (report.jefaturaManual) {
    field('Nombre de la jefatura que autoriza el gasto','jefatura','text','',120);
    form.append(node('p','Aún no hay jefaturas registradas. Ingresa el nombre de la persona que autorizó el cometido.','muted report-wide'));
  } else {
    const manager = field('Jefatura que autoriza el gasto','jefatura','select');
    manager.append(node('option','Selecciona una jefatura'));
    for (const name of report.jefaturas) manager.append(node('option',name));
    manager.options[0].value = '';
    if (report.demo) manager.value = report.jefaturas[0];
  }
  field('Folio del cometido','folio','text',report.folioCometido || '',100);
  field('Fecha de rendición','fechaRendicion','date',report.fechaRendicion);
  field('Resolución Exenta (si aplica)','resolucion','text','',120,false);
  field('Fecha de resolución (si aplica)','fechaResolucion','date','',undefined,false);
  field('Proyecto del cometido (si aplica)','proyecto','text','',160,false);
  const notes = field('Detalle de labores y observaciones','observaciones','textarea',report.observaciones || '',1500);
  notes.rows = 4;
  notes.parentElement.className = 'report-wide';
  form.addEventListener('submit',event => event.preventDefault());
  const summary = (report.demo ? 'Muestra sin validez institucional.\n' : '')+trip.destino+' · Desde '+dateLabel(trip.ida)+' · Hasta '+dateLabel(trip.regreso);
  openDialog('Informe de cometido',summary,'Descargar PDF',async () => {
    if (!form.reportValidity()) return;
    const response = await fetch('/api/'+endpoint,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/pdf')) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'No se pudo generar el PDF.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = node('a','');
    link.href = url;
    link.download = report.demo ? 'informe-cometido-muestra.pdf' : 'informe-cometido-'+trip.folio+'.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    return 'Informe de cometido descargado.';
  });
  get('dialog-fields').append(form);
  rut.focus();
}
function appendPassengerCompletion(card, trip) {
  if (session.fullAdmin || !trip.puede_confirmar_realizacion) return;
  const section = node('div','','form-actions');
  const viewer = session.rol === 'consulta';
  const button = node('button',viewer ? 'Editar' : 'Marcar como realizado','secondary');
  if (viewer) button.setAttribute('aria-label','Editar estado del viaje '+trip.folio);
  button.addEventListener('click',() => {
    const label = node('label','Nuevo estado');
    const state = node('select','');
    const placeholder = node('option','Selecciona un estado');
    placeholder.value = '';
    const completed = node('option','Realizado');
    completed.value = 'realizado';
    state.required = true;
    state.append(placeholder,completed);
    label.append(state);
    openDialog(viewer ? 'Editar estado del viaje' : 'Marcar viaje como realizado',
      'Confirma que realizaste el viaje de ida y regreso. Esto habilitará el informe de cometido.',
      viewer ? 'Guardar cambio' : 'Confirmar realización',async () => {
        if (viewer && !state.reportValidity()) return;
        if (liveSession) completedPreviewTrips.add(trip.folio);
        else await api('viajes/'+trip.folio,'PATCH',{estado:'realizado'});
        if (filterParams.get('estado') && filterParams.get('estado') !== 'realizado') {
          filterParams.set('estado','realizado');
          filters.elements.estado.value = 'realizado';
          offset = 0;
        }
        await load();
        return 'Viaje marcado como realizado. Ya puedes generar tu informe de cometido.';
      });
    if (viewer) {
      get('dialog-fields').append(label);
      state.focus();
    }
  });
  section.append(button);
  card.append(section);
}
function appendTripReport(card, trip) {
  const available = trip.puede_generar_informe || (liveSession && trip.estado === 'realizado');
  if (!trip.puede_ver_opcion_informe && !available) return;
  const section = node('div','','form-actions');
  const button = node('button','Generar informe de cometido','secondary');
  section.append(button);
  button.disabled = !available;
  if (available) {
    button.addEventListener('click',async () => {
      button.disabled = true;
      try { await openTripReport(trip); }
      finally { button.disabled = false; }
    });
  } else {
    const closed = ['cancelado','rechazado'].includes(trip.estado);
    const message = closed ? 'El informe se genera únicamente para viajes realizados.' :
      'Disponible cuando el viaje se marque como Realizado.';
    section.append(node('p',message,'muted'));
  }
  card.append(section);
}
function tripCard(trip) {
  const card = node('article','','card');
  const title = node('div','','trip-title');
  title.append(node('h2',trip.origen + ' → ' + trip.destino),node('span',states[trip.estado],'tag '+trip.estado));
  card.append(title,node('p',trip.unidad,'trip-metadata'),node('p',trip.folio,'trip-metadata muted'));
  if (trip.nombre_solicitante) card.append(node('p','Solicitante: '+trip.nombre_solicitante,'trip-metadata'));
  const passengers = node('ul','');
  for (const name of trip.pasajeros) passengers.append(node('li',name));
  card.append(node('strong',trip.pasajeros.length === 1 ? 'Pasajero' : 'Pasajeros ('+trip.pasajeros.length+')'),passengers);
  if (trip.vehiculo) card.append(node('p','Vehículo asignado: '+trip.vehiculo,'trip-metadata'));
  const times = node('div','','stops');
  for (const [label,value] of [['Ida',trip.ida],['Regreso',trip.regreso]]) {
    const stop = node('div','');
    stop.append(node('strong',label),node('span',dateLabel(value)));
    times.append(stop);
  }
  card.append(times);
  if (view === 'visualizador') {
    if (trip.notas) card.append(node('p','Comentarios: '+trip.notas,'trip-metadata muted'));
    appendTripReport(card,trip);
    return card;
  }
  const actions = node('div','','actions');
  let vehicleSelect;
  let comments;
  const canAssign = (session.rol === 'coordinacion' || session.fullAdmin) && ['pendiente','confirmado'].includes(trip.estado);
  if (canAssign) {
    const label = node('label','Vehículo','vehicle-field');
    vehicleSelect = node('select','');
    const placeholder = node('option','Selecciona un vehículo');
    placeholder.value = '';
    vehicleSelect.append(placeholder);
    for (const vehicle of session.vehiculos) {
      const option = node('option',vehicle);
      option.value = vehicle;
      vehicleSelect.append(option);
    }
    vehicleSelect.value = trip.vehiculo || '';
    label.append(vehicleSelect);
    const commentsLabel = node('label','Comentarios');
    comments = node('textarea','');
    comments.rows = 2;
    comments.maxLength = 500;
    comments.value = trip.notas;
    commentsLabel.append(comments);
    card.append(label,commentsLabel);
    actions.style.marginTop = '12px';
  } else if (trip.notas) {
    card.append(node('p','Comentarios: '+trip.notas,'trip-metadata muted'));
  }
  const addAction = (label,status,className,detail,assign = false) => {
    const button = node('button',label,className);
    button.addEventListener('click',() => {
      const vehiculo = assign || status === 'editar' ? vehicleSelect.value || null : undefined;
      const comentarios = canAssign ? comments.value : undefined;
      if (assign && !vehiculo) {
        vehicleSelect.required = true;
        vehicleSelect.reportValidity();
        vehicleSelect.focus();
        return;
      }
      openDialog(label,assign ? detail+' '+vehiculo+'.' : detail,label,async () => {
        const currentView = view;
        await api('viajes/'+trip.folio,'PATCH',{estado:status,vehiculo,comentarios});
        if (currentView === view) {
          if (view === 'confirmar') offset = 0;
          await load();
        }
        return status === 'editar' ? 'Cambios guardados.' : 'Viaje ' + states[status].toLowerCase() + '.';
      });
    });
    actions.append(button);
  };
  if (canAssign && trip.estado === 'pendiente') {
    addAction('Validar viaje','confirmado','','La solicitud quedará aceptada con el vehículo',true);
    addAction('Rechazar viaje','rechazado','danger','La solicitud saldrá de la lista de pendientes y quedará como rechazada.');
  }
  if (canAssign) {
    addAction('Guardar cambios','editar','secondary','Se guardarán el vehículo seleccionado y los comentarios.');
  }
  if (session.fullAdmin && ['pendiente','confirmado'].includes(trip.estado)) {
    if (trip.estado === 'confirmado') addAction('Marcar realizado','realizado','secondary','Verifica que la ida y el regreso se hayan realizado.');
    addAction('Cancelar viaje','cancelado','danger','La solicitud dejará de estar disponible para coordinar.');
  }
  appendPassengerCompletion(card,trip);
  appendTripReport(card,trip);
  if (session.fullAdmin) {
    const edit = node('button','Editar viaje','secondary');
    edit.addEventListener('click',() => editTrip(trip));
    const remove = node('button','Eliminar viaje','danger');
    remove.addEventListener('click',() => openDialog('Eliminar viaje',
      'Se eliminará permanentemente el viaje '+trip.folio+'.','Eliminar viaje',async () => {
        await api('admin/viajes/'+trip.folio,'DELETE');
        offset = 0;
        await load();
        return 'Viaje eliminado.';
      }));
    actions.append(edit,remove);
  }
  if (actions.children.length) card.append(actions);
  return card;
}
function localChileNow() {
  const parts = new Intl.DateTimeFormat('sv-SE',{
    timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts();
  const p = Object.fromEntries(parts.map(part => [part.type,part.value]));
  return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;
}
function previewTrips(query, today) {
  const dateAt = days => {
    const day = new Date(today+'T00:00:00Z');
    day.setUTCDate(day.getUTCDate()+days);
    return day.toISOString().slice(0,10);
  };
  const examples = [
    {folio:'DEMO-003',origen:'Rancagua',destino:'Machalí',day:4,estado:'pendiente'},
    {folio:'DEMO-002',origen:'San Fernando',destino:'Santa Cruz',day:-2,estado:'confirmado',vehiculo:'Taxi II'},
    {folio:'DEMO-001',origen:'Pichilemu',destino:'Paredones',day:-5,estado:'realizado',vehiculo:'Van'}
  ];
  const folio = (query.get('folio') || '').trim().toUpperCase();
  const date = query.get('fecha');
  const state = query.get('estado');
  return {
    viajes:examples.map(({day,...trip}) => ({
      ...trip,
      estado:completedPreviewTrips.has(trip.folio) ? 'realizado' : trip.estado,
      puede_confirmar_realizacion:trip.estado === 'confirmado' && !completedPreviewTrips.has(trip.folio),
      puede_ver_opcion_informe:true,
      unidad:'Unidad de ejemplo', nombre_solicitante:'Solicitante de ejemplo',
      pasajeros:['Visualizador de prueba'],ida:dateAt(day)+'T09:30',regreso:dateAt(day)+'T12:00'
    })).filter(trip => trip.folio.includes(folio) && (!date || trip.ida.startsWith(date)) && (!state || trip.estado === state)),
    next:null
  };
}
async function load() {
  const id = ++loadId;
  const result = get('results');
  result.replaceChildren(node('p','Cargando viajes…','empty'));
  get('previous').hidden = true;
  get('next').hidden = true;
  try {
    const query = new URLSearchParams(filterParams);
    if (view === 'confirmar') query.set('estado','pendiente');
    query.set('offset',String(offset));
    const data = liveSession ? previewTrips(query,session.now.slice(0,10)) : await api('viajes?'+query);
    if (id !== loadId) return;
    nextOffset = data.next;
    const empty = view === 'confirmar' ? 'No hay viajes pendientes que coincidan con la búsqueda.' : 'No hay viajes que coincidan con la búsqueda.';
    result.replaceChildren(...(data.viajes.length ? data.viajes.map(tripCard) : [node('p',empty,'empty')]));
    get('previous').hidden = offset === 0;
    get('next').hidden = nextOffset === null;
  } catch (failure) {
    if (id === loadId) result.replaceChildren(node('p',failure.message,'empty error'));
  }
}
function openView(target, focus = true) {
  if (liveSession && target !== 'visualizar') return;
  if (target === 'visualizador' && !session.fullAdmin) return;
  loadId++;
  view = target;
  const ownTrips = target === 'visualizar' && session.rol === 'consulta' && !session.fullAdmin;
  get('title').textContent = ownTrips ? 'Mis viajes' : copy[target][0];
  get('intro').textContent = ownTrips ? 'Consulta el estado y los detalles de los viajes asociados a tu cuenta.' : copy[target][1];
  for (const button of get('nav').querySelectorAll('button')) {
    if (button.dataset.view === target) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  get('register-actions').hidden = target !== 'registrar' || tripFormOpen;
  register.hidden = target !== 'registrar' || !tripFormOpen;
  get('history').hidden = !['visualizar','visualizador','confirmar'].includes(target);
  get('trip-export').hidden = target !== 'visualizar' || !canExportTrips();
  get('profiles-panel').hidden = target !== 'perfiles';
  get('import-form').hidden = target !== 'importar';
  show('');
  if (focus) get('title').focus();
  if (target === 'perfiles') { void loadProfiles(); return; }
  if (target === 'registrar') { if (tripFormOpen) void loadTripOptions(); return; }
  if (target === 'importar') return;
  filters.reset();
  filters.classList.toggle('confirm',target === 'confirmar');
  get('state-filter').hidden = target === 'confirmar';
  offset = 0;
  filterParams = new URLSearchParams();
  void load();
}
for (const button of get('nav').querySelectorAll('button')) {
  button.addEventListener('click',() => openView(button.dataset.view));
}
filters.addEventListener('submit',event => {
  event.preventDefault();
  filterParams = new URLSearchParams(new FormData(filters));
  offset = 0;
  show('');
  void load();
});
get('previous').addEventListener('click',() => { offset -= 20; void load(); });
get('next').addEventListener('click',() => { offset = nextOffset; void load(); });
register.elements.fechaIda.addEventListener('change',() => {
  const date = register.elements.fechaIda.value;
  register.elements.fechaRegreso.min = date || session.now.slice(0,10);
  if (register.elements.fechaRegreso.value < date) register.elements.fechaRegreso.value = date;
});
let tripFormOpen = false;
let optionsLoading = false;
let passengers = [];
let communes = [];
function setOptions(select, values, placeholder) {
  const current = select.value;
  const empty = node('option',placeholder);
  empty.value = '';
  select.replaceChildren(empty,...values.map(value => {
    const option = node('option',value);
    option.value = value;
    return option;
  }));
  select.value = values.includes(current) ? current : '';
  select.disabled = !values.length;
}
function updateCommuneOptions() {
  setOptions(register.elements.origen,communes,'Selecciona una comuna');
  setOptions(register.elements.destino,communes,'Selecciona una comuna');
}
function syncTripOptions() {
  get('review-request').disabled = optionsLoading || !passengers.length || !communes.length;
  get('add-commune').disabled = optionsLoading;
}
async function loadTripOptions() {
  if (optionsLoading) return;
  optionsLoading = true;
  syncTripOptions();
  const feedback = get('passenger-feedback');
  const refresh = get('refresh-passengers');
  feedback.hidden = false;
  feedback.textContent = 'Cargando pasajeros y comunas…';
  refresh.hidden = true;
  try {
    const [people,places] = await Promise.all([api('pasajeros'),api('comunas')]);
    passengers = people.pasajeros;
    communes = places.comunas;
    feedback.textContent = passengers.length ? '' : 'Se necesita al menos un perfil activo con nombre completo.';
  } catch (failure) {
    passengers = [];
    communes = [];
    feedback.textContent = failure.message;
  } finally {
    const select = register.elements.pasajero_correo;
    const selected = select.value;
    const placeholder = node('option','Selecciona un pasajero');
    placeholder.value = '';
    const counts = new Map();
    for (const profile of passengers) counts.set(profile.nombre,(counts.get(profile.nombre) || 0)+1);
    select.replaceChildren(placeholder,...passengers.map(profile => {
      const label = counts.get(profile.nombre) > 1 ? profile.nombre+' · '+profile.correo : profile.nombre;
      const option = node('option',label);
      option.value = profile.correo;
      return option;
    }));
    select.value = passengers.some(profile => profile.correo === selected) ? selected : '';
    select.disabled = !passengers.length;
    updateCommuneOptions();
    optionsLoading = false;
    syncTripOptions();
    feedback.hidden = !feedback.textContent;
    refresh.hidden = Boolean(passengers.length && communes.length);
  }
}
function setTripOpen(open) {
  tripFormOpen = open;
  register.hidden = !open;
  get('register-actions').hidden = open;
  get('new-trip').setAttribute('aria-expanded',String(open));
  if (open) void loadTripOptions();
}
get('new-trip').addEventListener('click',() => {
  setTripOpen(true);
  register.querySelector('h2').focus();
});
get('close-trip').addEventListener('click',() => {
  setTripOpen(false);
  get('new-trip').focus();
});
get('refresh-passengers').addEventListener('click',() => void loadTripOptions());
get('add-commune').addEventListener('click',() => {
  const label = node('label','Nombre de la comuna');
  const input = node('input','');
  input.required = true;
  input.maxLength = 100;
  label.append(input);
  openDialog('Agregar comuna','','Guardar comuna',async () => {
    if (!input.reportValidity()) return;
    const result = await api('comunas','POST',{nombre:input.value});
    communes = [...communes,result.nombre].sort((a,b) => a.localeCompare(b,'es-CL'));
    updateCommuneOptions();
    syncTripOptions();
    return 'Comuna agregada: '+result.nombre+'.';
  });
  get('dialog-fields').append(label);
  input.focus();
});
register.addEventListener('submit',event => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(register));
  form.pasajero = passengers.find(profile => profile.correo === form.pasajero_correo)?.nombre || '';
  const {fechaIda,horaIda,fechaRegreso,horaRegreso,...details} = form;
  const ida = fechaIda+'T'+horaIda;
  const regreso = fechaRegreso+'T'+horaRegreso;
  if (ida < localChileNow() || regreso <= ida) {
    show('Verifica que la ida sea a partir de la hora actual y que el regreso sea posterior.',true);
    (ida < localChileNow() ? register.elements.horaIda : register.elements.horaRegreso).focus();
    return;
  }
  const payload = {...details,ida,regreso};
  const key = JSON.stringify(payload);
  if (key !== draftKey) {
    draftKey = key;
    draft = {...payload,requestId:crypto.randomUUID().replaceAll('-','')};
  }
  const summary = ['Solicitante: '+get('requester-name').value,form.pasajero+' · '+form.unidad,form.origen+' → '+form.destino,
    'Ida '+dateLabel(ida),'Regreso '+dateLabel(regreso),form.notas].filter(Boolean).join('\n');
  openDialog('Revisar solicitud',summary,'Registrar viaje',async () => {
    const result = await api('viajes','POST',draft);
    register.reset();
    register.elements.fechaRegreso.min = register.elements.fechaIda.min;
    draftKey = undefined;
    setTripOpen(false);
    requestAnimationFrame(() => get('new-trip').focus());
    return 'Solicitud registrada. Folio '+result.folio+'.';
  });
});
let profileEditing = false;
let profileRequest = 0;
const profileSearch = get('profile-search');
function profileFeedback(text, failed = false) {
  get('profile-feedback').textContent = text;
  get('profile-feedback').className = failed ? 'feedback error' : 'feedback';
}
function editProfile(profile) {
  profileEditing = Boolean(profile);
  profileForm.reset();
  profileForm.elements.correo.readOnly = profileEditing;
  get('profile-form-title').textContent = profileEditing ? 'Editar perfil' : 'Crear perfil';
  get('profile-save').textContent = profileEditing ? 'Guardar perfil' : 'Crear perfil';
  get('profile-cancel').hidden = !profileEditing;
  profileFeedback('');
  if (!profile) return;
  profileForm.elements.correo.value = profile.correo;
  profileForm.elements.cargo.value = profile.cargo;
  profileForm.elements.nombre.value = profile.nombre || '';
  profileForm.elements.rol.value = profile.administrador_general ? 'administrador' : profile.rol;
  profileForm.elements.activo.checked = profile.activo === 1;
  get('profile-form-title').focus();
}
async function loadProfiles() {
  const requestId = ++profileRequest;
  const target = get('profile-results');
  target.replaceChildren(node('p','Cargando perfiles…','muted'));
  try {
    const query = new URLSearchParams(new FormData(profileSearch));
    const result = await api('perfiles?'+query);
    if (requestId !== profileRequest) return;
    target.replaceChildren();
    if (!result.perfiles.length) target.append(node('p','No se encontraron perfiles.','muted'));
    for (const profile of result.perfiles) {
      const row = node('article','','profile-row');
      const details = node('div','');
      const summary = [profile.cargo,profiles[profile.administrador_general ? 'administrador' : profile.rol],profile.activo ? 'Activo' : 'Inactivo'];
      details.append(node('strong',profile.nombre || profile.correo));
      if (profile.nombre) details.append(node('p',profile.correo,'muted'));
      details.append(node('p',summary.join(' · '),'muted'));
      row.append(details);
      if (profile.editable) {
        const button = node('button','Editar','secondary');
        button.disabled = get('profile-save').disabled;
        button.setAttribute('aria-label','Editar perfil de '+profile.correo);
        button.addEventListener('click',() => editProfile(profile));
        row.append(button);
      }
      if (profile.eliminable) {
        const button = node('button','Eliminar','danger');
        button.disabled = get('profile-save').disabled;
        button.setAttribute('aria-label','Eliminar perfil de '+profile.correo);
        button.addEventListener('click',() => openDialog('Eliminar perfil',
          'Se eliminará el perfil de '+profile.correo+'. Sus viajes seguirán en el historial.',
          'Eliminar perfil',async () => {
            await api('perfiles','DELETE',{correo:profile.correo});
            if (profileForm.elements.correo.value === profile.correo) editProfile(null);
            await loadProfiles();
            return 'Perfil eliminado.';
          }));
        row.append(button);
      }
      target.append(row);
    }
    if (result.mas) target.append(node('p','Acota la búsqueda para ver más resultados.','muted'));
  } catch (failure) {
    if (requestId === profileRequest) target.replaceChildren(node('p',failure.message,'error'));
  }
}
profileSearch.addEventListener('submit',event => {
  event.preventDefault();
  void loadProfiles();
});
get('profile-cancel').addEventListener('click',() => editProfile(null));
profileForm.addEventListener('submit',async event => {
  event.preventDefault();
  const controls = [get('profile-save'),get('profile-cancel'),...get('profile-results').querySelectorAll('button')];
  for (const button of controls) button.disabled = true;
  const {correo,nombre,cargo,rol,activo} = profileForm.elements;
  const editing = profileEditing;
  profileFeedback('Guardando perfil…');
  try {
    const profile = await api('perfiles',editing ? 'PATCH' : 'POST',{
      correo:correo.value,nombre:nombre.value,cargo:cargo.value,rol:rol.value === 'administrador' ? 'consulta' : rol.value,activo:activo.checked,
      administrador_general:rol.value === 'administrador'
    });
    editProfile(null);
    profileFeedback((editing ? 'Perfil actualizado para ' : 'Perfil creado para ')+profile.correo+'.');
    profileSearch.elements.correo.value = profile.correo;
  } catch (failure) {
    profileFeedback(failure.message,true);
    return;
  } finally {
    get('profile-save').disabled = false;
    get('profile-cancel').disabled = false;
    for (const button of get('profile-results').querySelectorAll('button')) button.disabled = false;
  }
  void loadProfiles();
});
const tripExport = get('trip-export');
const tripExportForm = get('trip-export-form');
function canExportTrips() {
  return !liveSession && (session.fullAdmin || session.rol === 'coordinacion');
}
let loadingExportOptions = false;
tripExport.addEventListener('toggle',async () => {
  if (!tripExport.open || !canExportTrips() || loadingExportOptions) return;
  loadingExportOptions = true;
  const status = get('trip-export-feedback');
  const button = tripExportForm.querySelector('button');
  button.disabled = true;
  status.hidden = true;
  try {
    const result = await api('exportar-viajes?opciones=1');
    setOptions(tripExportForm.elements.destino,result.destinos,'Todas');
    setOptions(tripExportForm.elements.vehiculo,session.vehiculos,'Todos');
  } catch (failure) {
    status.textContent = failure.message;
    status.hidden = false;
  } finally {
    button.disabled = false;
    loadingExportOptions = false;
  }
});
tripExportForm.addEventListener('submit',async event => {
  event.preventDefault();
  if (!canExportTrips()) return;
  const status = get('trip-export-feedback');
  const button = tripExportForm.querySelector('button');
  button.disabled = true;
  status.hidden = true;
  try {
    const params = new URLSearchParams(new FormData(tripExportForm));
    const response = await fetch('/api/exportar-viajes?'+params);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'No se pudo exportar el archivo.');
    }
    if (!response.headers.get('content-type')?.startsWith('text/csv')) throw new Error('Vuelve a iniciar sesión para descargar.');
    const blob = await response.blob();
    if (!canExportTrips()) return;
    const url = URL.createObjectURL(blob);
    const link = node('a','');
    link.href = url;
    link.download = 'viajes.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    status.textContent = 'Archivo CSV descargado.';
  } catch (failure) {
    status.textContent = failure.message;
  } finally {
    status.hidden = false;
    button.disabled = false;
  }
});
function renderSession() {
  const preview = Boolean(liveSession);
  const previewButton = get('toggle-viewer-preview');
  previewButton.hidden = !session.fullAdmin && !preview;
  previewButton.textContent = preview ? 'Salir de vista previa' : 'Vista previa de Visualizador';
  get('viewer-preview-note').hidden = !preview;
  get('email').textContent = [session.nombre,session.email].filter(Boolean).join(' · ');
  get('role').textContent = session.fullAdmin ? 'Administrador' : [profiles[session.rol],session.cargo].filter(Boolean).join(' · ');
  get('nav').hidden = false;
  get('nav').querySelector('[data-view="registrar"]').hidden = session.rol !== 'jefatura' && !session.fullAdmin;
  get('nav').querySelector('[data-view="confirmar"]').hidden = session.rol !== 'coordinacion' && !session.fullAdmin;
  const viewTrips = get('nav').querySelector('[data-view="visualizar"]');
  viewTrips.hidden = !session.rol && !session.fullAdmin;
  viewTrips.lastChild.textContent = session.rol === 'consulta' && !session.fullAdmin ? 'Mis viajes' : 'Visualizar viajes';
  get('nav').querySelector('[data-view="perfiles"]').hidden = !session.canManageProfiles;
  get('admin-profile-option').hidden = !session.canGrantFullAdmin;
  get('admin-profile-option').disabled = !session.canGrantFullAdmin;
  get('nav').querySelector('[data-view="importar"]').hidden = !session.fullAdmin;
  get('nav').querySelector('[data-view="visualizador"]').hidden = !session.fullAdmin;
  get('export-link').hidden = !session.canExport;
  get('add-commune').hidden = !session.fullAdmin;
}
let previousView;
get('toggle-viewer-preview').addEventListener('click',() => {
  if (liveSession) {
    session = liveSession;
    liveSession = undefined;
    renderSession();
    openView(previousView);
    return;
  }
  if (!session?.fullAdmin) return;
  previousView = view;
  completedPreviewTrips.clear();
  liveSession = session;
  session = {rol:'consulta',nombre:'Visualizador de prueba',now:session.now};
  renderSession();
  openView('visualizar');
});
(async () => {
  try {
    session = await api('perfil');
    if (!session.rol && !session.canManageProfiles) {
      get('email').textContent = session.email;
      get('access').textContent = 'Tu cuenta aún no tiene un perfil activo. Solicita el alta al equipo administrador del portal.';
      return;
    }
    get('access').hidden = true;
    get('requester-name').defaultValue = session.nombre || session.email;
    register.elements.fechaIda.min = session.now.slice(0,10);
    register.elements.fechaRegreso.min = session.now.slice(0,10);
    renderSession();
    openView(session.rol === 'jefatura' ? 'registrar' : session.rol || session.fullAdmin ? 'visualizar' : 'perfiles',false);
  } catch (failure) {
    get('access').textContent = failure.message;
  }
})();
