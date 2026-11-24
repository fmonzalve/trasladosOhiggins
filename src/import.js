const importForm = get('import-form');
const columns = {
  perfiles:['correo','nombre','cargo','rol','activo'],
  viajes:['id_externo','correo_solicitante','nombre_solicitante','pasajero','pasajeros_adicionales','unidad','origen','destino','ida','regreso','notas','vehiculo','estado']
};
function parseCsv(input, expected) {
  const text = input.replace(/^\uFEFF/,'');
  const separator = text.split(/\r?\n/,1)[0].includes(';') ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const endField = () => { row.push(field.trim()); field = ''; closed = false; };
  const endRow = () => { endField(); if (row.some(Boolean)) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === separator) endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i+1] === '\n') i++;
      endRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === '"' || closed) throw new Error('Hay comillas inválidas en el CSV.');
    else field += char;
  }
  if (quoted) throw new Error('El CSV contiene un campo con comillas sin cerrar.');
  endRow();
  const header = rows.shift() || [];
  const required = expected.filter(name => !['nombre','nombre_solicitante'].includes(name));
  if (new Set(header).size !== header.length || required.some(name => !header.includes(name)) ||
      header.some(name => !expected.includes(name))) throw new Error('Usa los encabezados de la plantilla descargada.');
  if (!rows.length || rows.length > 40) throw new Error('Incluye entre 1 y 40 filas de datos por archivo.');
  return rows.map((values,index) => {
    if (values.length !== header.length) throw new Error('La fila de datos '+(index+1)+' tiene un número incorrecto de columnas.');
    return Object.fromEntries(header.map((name,i) => [name,values[i]]));
  });
}
get('import-template').addEventListener('click',() => {
  const type = importForm.elements.tipo.value;
  const url = URL.createObjectURL(new Blob(['\uFEFF'+columns[type].join(';')+'\r\n'],{type:'text/csv;charset=utf-8'}));
  const link = node('a','');
  link.href = url;
  link.download = 'plantilla-'+type+'.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});
importForm.addEventListener('submit',async event => {
  event.preventDefault();
  const button = get('import-submit');
  button.disabled = true;
  const tipo = importForm.elements.tipo.value;
  const archivo = importForm.elements.archivo.files[0];
  show('');
  try {
    if (!archivo || archivo.size > 150000) throw new Error('Selecciona un CSV de hasta 150 KB.');
    const filas = parseCsv(await archivo.text(),columns[tipo]);
    openDialog('Confirmar carga',archivo.name+' · '+filas.length+' filas de '+tipo,'Importar',async () => {
      const result = await api('importar','POST',{tipo,filas});
      importForm.elements.archivo.value = '';
      return 'Registros importados: '+result.importados+'. Registros ya existentes: '+result.omitidos+'.';
    });
  } catch (failure) {
    show(failure.message,true);
  } finally {
    button.disabled = false;
  }
});
