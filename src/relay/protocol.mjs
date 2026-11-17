import {z} from 'zod';
const sessionId=z.string().regex(/^ses[a-zA-Z0-9_-]{1,180}$/);
const empty=z.object({}).strict();
export const OPERATIONS=Object.freeze({
 health:{scope:'read',schema:empty},version:{scope:'read',schema:empty},providers:{scope:'read',schema:empty},models:{scope:'read',schema:empty},projects:{scope:'read',schema:empty},sessions:{scope:'read',schema:empty},mcp:{scope:'read',schema:empty},
 get:{scope:'read',schema:z.object({sessionId}).strict()},messages:{scope:'read',schema:z.object({sessionId}).strict()},diff:{scope:'read',schema:z.object({sessionId}).strict()},
 create:{scope:'execute',schema:z.object({title:z.string().max(200).optional()}).strict()},prompt:{scope:'execute',schema:z.object({sessionId,text:z.string().min(1).max(32000)}).strict()},abort:{scope:'execute',schema:z.object({sessionId}).strict()}
});
export function validateOperation(operation,input={}){const definition=OPERATIONS[operation];if(!definition)throw Object.assign(Error('Operação não autorizada.'),{status:400});return {operation,input:definition.schema.parse(input),scope:definition.scope};}
export function validateId(value){if(typeof value!=='string'||!/^[-_a-zA-Z0-9]{8,180}$/.test(value))throw Object.assign(Error('Identificador inválido.'),{status:400});return value;}
export function fail(message,status=403){throw Object.assign(Error(message),{status});}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export const randomToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
export function tokenMatches(actual,expected){if(typeof actual!=='string'||typeof expected!=='string'||actual.length!==expected.length)return false;let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);return diff===0;}
