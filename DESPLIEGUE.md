# Desplegar en tu cuenta de Cloudflare

El paquete contiene el código de la aplicación y las migraciones SQL. La base nueva se crea vacía. Para migrar registros, usa las plantillas de **Carga masiva** y exporta los datos desde el sistema de origen.

## Preparación

1. Usa Node.js 22 o posterior. Descomprime el ZIP y abre una terminal en la carpeta. Ejecuta `npm ci` y `npx wrangler login` con tu cuenta de Cloudflare.
2. Crea la base con `npx wrangler d1 create portal-traslados`. Copia el `database_id` de la salida a `wrangler.jsonc`. Conserva el nombre de vinculación `DB`.
3. En Cloudflare Zero Trust, configura una aplicación **Self-hosted** para todo el subdominio que usará el portal, incluido `/api/*`, con una política Allow para los usuarios autorizados y el proveedor de identidad institucional que corresponda. Si la aplicación permite únicamente tu cuenta durante el piloto, deja ese mismo correo como administrador. Copia la URL del equipo y el **Application Audience (AUD)**.
4. Configura en `wrangler.jsonc` el subdominio real de tu zona de Cloudflare, `ACCESS_TEAM_URL`, `ACCESS_AUD` y `PROFILE_ADMIN_EMAIL`. El correo debe coincidir con el de Cloudflare Access. Mantén las URLs `workers.dev` y de vista previa desactivadas.

## Publicación

```bash
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

Abre el dominio configurado e inicia sesión. El propietario indicado en `PROFILE_ADMIN_EMAIL` recibe el permiso Administrador. Las otras cuentas requieren tanto una política de acceso que las incluya como un perfil activo dentro del portal.

## Carga masiva

Desde **Carga masiva**, elige el tipo y descarga la plantilla. Guarda como CSV UTF-8 con punto y coma o coma de separación. Usa hasta 40 filas por archivo. Los errores de datos detienen el lote y los registros ya existentes se omiten. La importación de perfiles no concede permisos de administración. Carga primero los perfiles si vas a probar acceso con las solicitantes históricos.

- **Perfiles**. Completa `correo`, `nombre`, `cargo` y `rol` (`solicitante`, `coordinador` o `visualizador`). En `activo`, usa `1` o `0`. El valor vacío equivale a `1`. El correo del administrador principal se define en la configuración.
- **Viajes**. Usa un `id_externo` único y estable, por ejemplo `sharepoint-123`. Completa el correo y el nombre del solicitante, el pasajero principal, la unidad, el origen, el destino y las horas. Usa fechas con formato `AAAA-MM-DDTHH:MM` en horario de Santiago y separa los pasajeros adicionales con `|`. Las notas, los pasajeros adicionales, el vehículo y el estado se pueden dejar vacíos cuando corresponda. Los estados válidos son `pendiente`, `confirmado`, `realizado`, `cancelado` y `rechazado`. Para `confirmado`, indica el vehículo exacto entre `Taxi I`, `Taxi II`, `Taxi III`, `Taxi IV` o `Van`.

Las credenciales de la sesión alojada se reemplazan por Cloudflare Access. El Worker valida la firma, el emisor, la audiencia y la vigencia del token antes de utilizar su identidad.

Los CSV anteriores siguen siendo compatibles. Si falta el nombre en un viaje importado, el portal usa el nombre del perfil asociado al correo cuando está disponible.

## Inicio de sesión con código por correo

En Cloudflare Zero Trust, activa **One-time PIN** como método de inicio de sesión y selecciónalo para la aplicación del portal. Si quieres que el código sea la única forma de entrar, deja solo ese método en la aplicación. Limita la política **Allow** a los correos autorizados. Cloudflare envía el código al correo de la persona. Una vez validado, el portal aplica el perfil activo asociado a ese correo.
