# Portal de Traslados

Aplicación web independiente para solicitudes de taxi institucionales. Cloudflare D1 guarda perfiles y viajes. Los viajes quedan pendientes hasta que Coordinación confirma que el servicio fue coordinado con el proveedor.

## Habilitar una cuenta

Autoriza la cuenta en el sitio privado y agrega su correo de inicio de sesión, en minúsculas, a la tabla `perfiles` de D1:

```sql
INSERT INTO perfiles (correo, cargo, rol)
VALUES ('jefatura@ejemplo.cl', 'Jefatura de Operaciones', 'jefatura');
```

La interfaz ofrece cuatro perfiles: **Administrador**, **Coordinador**, **Solicitante** y **Visualizador**. Los identificadores existentes de base de datos se conservan: `coordinacion`, `jefatura` y `consulta`. Solicitante registra y consulta sus propios viajes, Coordinador revisa las solicitudes y Visualizador consulta en modo de lectura sus solicitudes y los viajes vinculados a su cuenta como pasajero. Administrador accede a todos los flujos del portal. Configura `activo = 0` para revocar el acceso.

Ejecuta `node build.mjs` para generar el Worker. La migración de D1 vive en `drizzle/0000_portal.sql`.

La cuenta propietaria se identifica con `PROFILE_ADMIN_EMAIL` y su rol operativo se configura en `PROFILE_ADMIN_TRAVEL_ROLE`. Puede crear y editar perfiles desde **Administrar perfiles** y asignar el perfil Administrador. La cuenta destinataria también requiere acceso al sitio privado.

El portal usa JavaScript en el navegador y en Cloudflare Workers, HTML y CSS en la interfaz, y SQL en Cloudflare D1 (SQLite).

El permiso **Administrador** habilita todos los flujos de viajes y la gestión de perfiles de la aplicación, con eliminación individual confirmada. La cuenta propietaria lo tiene por defecto y puede asignarlo o retirarlo. Las cuentas con este permiso administran perfiles ordinarios. Eliminar un perfil revoca el acceso de aplicación y conserva las solicitudes históricas. El acceso al sitio privado se gestiona en Sites.

Para vincular un viaje anterior a una cuenta, el administrador puede usar **Editar viaje** y seleccionar la cuenta del pasajero principal. Los nombres históricos por sí solos no conceden acceso.


El pasajero principal, el solicitante vinculado y el Administrador pueden generar el Anexo 6.1 de un viaje realizado desde **Mis viajes** o **Visualizar viajes**. Se consideran jefaturas los perfiles activos de Solicitante con nombre completo. Si el catálogo está vacío, el formulario permite ingresar el nombre de quien autorizó el cometido. El RUT y los datos de rendición se usan para generar el PDF solicitado y no se guardan en D1.

Para que la cuenta propietaria opere exclusivamente como **Visualizador** en el portal, configura `PROFILE_ADMIN_TRAVEL_ROLE=consulta` y publica la configuración. Para devolverle las funciones administrativas, configura `PROFILE_ADMIN_TRAVEL_ROLE=coordinacion` y vuelve a publicar. El rol de propiedad del sitio se gestiona en Sites.
