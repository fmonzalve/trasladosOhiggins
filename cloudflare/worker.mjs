import {createRemoteJWKSet, jwtVerify} from 'jose';
import portal from '../dist/server/index.js';

let verifier;
function accessSettings(env) {
  const issuer = env.ACCESS_TEAM_URL?.trim().replace(/\/$/,'');
  const audience = env.ACCESS_AUD?.trim();
  if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience) return null;
  if (verifier?.issuer !== issuer) {
    verifier = {issuer, keys:createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'))};
  }
  return {...verifier,audience};
}

export default {
  async fetch(request, env) {
    const settings = accessSettings(env);
    if (!settings || !env.PROFILE_ADMIN_EMAIL?.trim()) {
      return new Response('Configura Cloudflare Access y el correo de administración.',{status:503});
    }
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) return new Response('Acceso institucional requerido.',{status:401});
    let identity;
    try {
      const {payload} = await jwtVerify(token,settings.keys,{
        issuer:settings.issuer,audience:settings.audience,algorithms:['RS256'],
        requiredClaims:['exp','iat','sub','email']
      });
      if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !payload.email.trim()) {
        return new Response('Identidad de usuario requerida.',{status:401});
      }
      identity = payload;
    } catch {
      return new Response('No se pudo verificar la sesión de Cloudflare Access.',{status:401});
    }
    const headers = new Headers(request.headers);
    headers.delete('oai-authenticated-user-full-name');
    headers.delete('oai-authenticated-user-full-name-encoding');
    if (typeof identity.name === 'string' && identity.name.trim()) {
      headers.set('oai-authenticated-user-full-name',encodeURIComponent(identity.name.trim().slice(0,120).toWellFormed()));
      headers.set('oai-authenticated-user-full-name-encoding','percent-encoded-utf-8');
    }
    headers.set('oai-authenticated-user-id',identity.sub);
    headers.set('oai-authenticated-user-email',identity.email.trim().toLowerCase());
    return portal.fetch(new Request(request,{headers}),env);
  }
};
