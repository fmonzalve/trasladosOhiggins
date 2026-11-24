import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';

const title = 'INFORME DE EJECUCIÓN COMETIDO FUNCIONARIO O';
const subtitle = 'COMISIÓN SERVICIO AL EXTRANJERO';
const ink = rgb(.10,.13,.16);
const line = rgb(.42,.46,.51);
const shade = rgb(.93,.95,.97);
const date = value => value ? value.slice(0,10).split('-').reverse().join('/') : '';

export async function generateReport(trip, data, logoBase64) {
  const doc = await PDFDocument.create();
  doc.setTitle('Anexo N° 6.1 - Informe de ejecución de cometido funcionario');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(logoBase64);
  const supported = new Set(normal.getCharacterSet());
  const clean = value => Array.from(String(value ?? '').normalize('NFC'), char =>
    char === '\n' || supported.has(char.codePointAt(0)) ? char : ' ').join('');
  let page;
  let top;
  const x = 36, width = 540, lineHeight = 13;
  const text = (value, left, y, size = 10, font = normal) => page.drawText(value,{x:left,y,size,font,color:ink});
  const frame = (left, y, w, h, fill) => page.drawRectangle({
    x:left,y,width:w,height:h,borderColor:line,borderWidth:.6,color:fill
  });
  function startPage(continued) {
    page = doc.addPage([612,792]);
    frame(24,30,564,730);
    const banner = 660;
    page.drawImage(logo,{x:46,y:banner+6,width:67,height:61});
    frame(x,banner,width,74);
    text('Anexo N° 6.1',x,741,11,bold);
    text(title,129,banner+44,11,bold);
    text(subtitle,129,banner+27,11,bold);
    if (data.demo) text('MUESTRA - SIN VALIDEZ',x+340,741,10,bold);
    if (continued) text('Folio '+clean(data.folio)+' · Continuación',129,banner+10,9);
    top = 637;
  }
  function wrap(value, max) {
    return clean(value).split('\n').flatMap(paragraph => {
      const lines = [];
      let current = '';
      for (const char of paragraph) {
        if (current && normal.widthOfTextAtSize(current+char,10) > max) {
          const split = current.lastIndexOf(' ');
          if (split > 0) {
            lines.push(current.slice(0,split));
            current = current.slice(split+1);
          } else {
            lines.push(current);
            current = '';
          }
        }
        current += char;
      }
      return [...lines,current];
    });
  }
  function section(label) {
    frame(x,top-22,width,22,shade);
    text(label,x+8,top-15,10,bold);
    top -= 22;
  }
  function row(label, value) {
    const labelWidth = 228;
    const lines = wrap(value,width-labelWidth-16);
    for (let i = 0; i < lines.length;) {
      if (top < 76) startPage(true);
      const count = Math.min(lines.length-i,Math.floor((top-56)/lineHeight));
      const height = Math.max(20,count*lineHeight+6);
      frame(x,top-height,labelWidth,height,shade);
      frame(x+labelWidth,top-height,width-labelWidth,height);
      text(i ? label+' (continuación)' : label,x+8,top-14,9.5,bold);
      for (let j = 0; j < count; j++) {
        text(lines[i+j],x+labelWidth+8,top-14-j*lineHeight);
      }
      top -= height;
      i += count;
    }
  }
  startPage(false);
  row('Nombre del/la funcionario/a',data.funcionario);
  row('RUT del/la funcionario/a',data.rut);
  row('Unidad de dependencia del/la funcionario/a',data.unidad);
  row('Nombre de la jefatura que autoriza el gasto',data.jefatura);
  row('Resolución Exenta que autoriza cometido',data.resolucion);
  row('Fecha Resolución',date(data.fechaResolucion));
  row('Fecha de la rendición',date(data.fechaRendicion));
  top -= 12;
  section('Principales Labores Desarrolladas');
  row('Folio del Cometido',data.folio);
  row('Fecha desde',date(trip.ida));
  row('Fecha hasta',date(trip.regreso));
  row('Lugar del Cometido',trip.destino);
  row('Proyecto cometido',data.proyecto);
  row('Detalle',data.observaciones);
  return await doc.save();
}
