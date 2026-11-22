import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
import {validateOperation,validateId,fail,randomToken,tokenMatches} from './protocol.mjs';
const KEEP=15*60*1000,LEASE=60000;
// All methods below are synchronous SQL transactions within one tenant/user DO.
// The Worker resolves the authenticated shard before calling this class.
export class RelayStore{
 constructor(sql,{now=Date.now}={}){this.sql=sql;this.now=now;
  sql.exec('CREATE TABLE IF NOT EXISTS pairs (ticket TEXT PRIMARY KEY, expires INTEGER NOT NULL, principal TEXT NOT NULL, scopes TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, token TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL, confirmation TEXT NOT NULL, expires INTEGER NOT NULL, seen INTEGER NOT NULL, principal TEXT NOT NULL, scopes TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, device TEXT NOT NULL, operation TEXT NOT NULL, input TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, lease TEXT, lease_until INTEGER, result TEXT)');
  sql.exec('CREATE INDEX IF NOT EXISTS jobs_device_state ON jobs(device,status,created)');
 }
 one(query,...args){return this.sql.exec(query,...args).toArray()[0];}
 sweep(){const now=this.now();this.sql.exec('DELETE FROM pairs WHERE expires < ?',now);this.sql.exec('DELETE FROM devices WHERE expires < ?',now);
  // A write may finish after its original queue deadline. Preserve its lease so
  // the authenticated device can still record the late receipt without retrying.
  this.sql.exec("UPDATE jobs SET status='unknown',expires=?,lease_until=NULL WHERE status='claimed' AND operation IN ('create','prompt','abort') AND lease_until < ?",now+KEEP,now);
  this.sql.exec("UPDATE jobs SET status='queued',lease=NULL,lease_until=NULL WHERE status='claimed' AND operation NOT IN ('create','prompt','abort') AND lease_until < ? AND expires >= ?",now,now);
  this.sql.exec("DELETE FROM jobs WHERE expires < ? AND NOT (status='claimed' AND operation IN ('create','prompt','abort'))",now);
 }
 pair(principal,scopes=['read']){this.sweep();if(!principal?.userId||!principal?.companyId)fail('Identidade ausente.');if(!Array.isArray(scopes)||scopes.some(s=>!['read','execute'].includes(s)))fail('Escopo inválido.',400);if(this.one("SELECT COUNT(*) AS n FROM pairs").n>=3)fail('Há pareamentos pendentes.',429);
  const ticket=randomToken();this.sql.exec('INSERT INTO pairs VALUES(?,?,?,?)',hash(ticket),this.now()+300000,JSON.stringify(principal),JSON.stringify([...new Set(['read',...scopes])]));return {ticket,expiresAt:this.now()+300000};
 }
 claim(ticket,name){this.sweep();const pairing=this.one('SELECT * FROM pairs WHERE ticket=?',hash(ticket));if(!pairing)fail('Pareamento inválido ou expirado.');if(typeof name!=='string'||!name.trim()||name.length>80)fail('Nome de dispositivo inválido.',400);if(this.one("SELECT COUNT(*) AS n FROM devices WHERE state!='revoked'").n>=3)fail('Limite de dispositivos atingido.',429);
  const id=crypto.randomUUID(),token=randomToken(),confirmation=randomToken().slice(0,8).toUpperCase();
  this.sql.exec('INSERT INTO devices VALUES(?,?,?,?,?,?,?,?,?)',id,hash(token),name,'pending',confirmation,this.now()+300000,this.now(),pairing.principal,pairing.scopes);this.sql.exec('DELETE FROM pairs WHERE ticket=?',hash(ticket));
  return {deviceId:id,deviceToken:token,confirmation,principal:JSON.parse(pairing.principal),expiresAt:this.now()+300000};
 }
 devices(){this.sweep();return this.sql.exec('SELECT id,name,state,confirmation,seen,expires,scopes FROM devices ORDER BY seen DESC').toArray().map(d=>({...d,scopes:JSON.parse(d.scopes),online:d.state==='approved'&&d.seen>this.now()-45000}));}
 approve(id,confirmation){const d=this.one('SELECT * FROM devices WHERE id=?',validateId(id));if(!d||d.state!=='pending'||d.expires<this.now()||!tokenMatches(confirmation,d.confirmation))fail('Confirmação de dispositivo inválida.');this.sql.exec("UPDATE devices SET state='approved',expires=? WHERE id=?",this.now()+86400000,id);return {approved:true};}
 revoke(id){this.sql.exec("UPDATE devices SET state='revoked',token='' WHERE id=?",validateId(id));this.sql.exec("UPDATE jobs SET status='cancelled',input='{}' WHERE device=? AND status='queued'",id);this.sql.exec("UPDATE jobs SET status='unknown',input='{}' WHERE device=? AND status='claimed'",id);return {revoked:true};}
 device(id,token){this.sweep();const d=this.one('SELECT * FROM devices WHERE id=?',validateId(id));if(!d||d.state==='revoked'||!tokenMatches(hash(token),d.token))fail('Dispositivo não autorizado.');return {...d,scopes:JSON.parse(d.scopes)};}
 submit({deviceId,operation,input={},key}){this.sweep();const d=this.one('SELECT * FROM devices WHERE id=?',validateId(deviceId));if(!d||d.state!=='approved'||d.expires<this.now())fail('Dispositivo indisponível.');const request=validateOperation(operation,input);if(!JSON.parse(d.scopes).includes(request.scope))fail('Dispositivo sem permissão para esta operação.');validateId(key);
  const serialized=JSON.stringify(request.input),fingerprint=hash(JSON.stringify([deviceId,operation,serialized]));const old=this.one('SELECT * FROM jobs WHERE id=?',key);if(old){if(old.fingerprint!==fingerprint)fail('Chave de tarefa reutilizada com conteúdo diferente.',409);return this.task(key);}
  if(this.one("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','claimed')").n>=20)fail('Fila cheia.',429);
  this.sql.exec('INSERT INTO jobs(id,device,operation,input,fingerprint,status,created,expires) VALUES(?,?,?,?,?,?,?,?)',key,deviceId,operation,serialized,fingerprint,'queued',this.now(),this.now()+KEEP);return this.task(key);
 }
 task(id){this.sweep();const row=this.one('SELECT id,device,operation,status,created,expires,result FROM jobs WHERE id=?',validateId(id));if(!row)fail('Tarefa não encontrada.',404);return {...row,...(row.result?{result:JSON.parse(row.result)}:{result:null})};}
 poll(id,token){const device=this.device(id,token);this.sql.exec('UPDATE devices SET seen=? WHERE id=?',this.now(),id);if(device.state!=='approved')return {state:device.state,job:null};if(this.one("SELECT id FROM jobs WHERE device=? AND status='claimed'",id))return {state:'approved',job:null};const row=this.one("SELECT * FROM jobs WHERE device=? AND status='queued' ORDER BY created LIMIT 1",id);if(!row)return {state:'approved',job:null};const lease=randomToken();this.sql.exec("UPDATE jobs SET status='claimed',lease=?,lease_until=? WHERE id=? AND status='queued'",lease,this.now()+LEASE,row.id);return {state:'approved',job:{id:row.id,operation:row.operation,input:JSON.parse(row.input),lease,expiresAt:row.expires}};}
 complete(id,token,{jobId,lease,status,result}){this.device(id,token);const job=this.one('SELECT * FROM jobs WHERE id=? AND device=?',validateId(jobId),id);if(!job||!['claimed','unknown'].includes(job.status)||!tokenMatches(lease,job.lease))fail('Recibo de tarefa inválido.',409);if(!['succeeded','failed','unknown'].includes(status))fail('Estado inválido.',400);const serialized=JSON.stringify(result??null);if(serialized.length>256000)fail('Resultado excede o limite.',413);this.sql.exec("UPDATE jobs SET status=?,result=?,input='{}',lease_until=NULL,expires=? WHERE id=?",status,serialized,this.now()+KEEP,jobId);return {recorded:true};}
}
