import {DurableObject} from 'cloudflare:workers';
import {RelayStore} from '../src/relay/store.mjs';
export class OpenCodeRelay extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.store=new RelayStore(ctx.storage.sql);}
 async owner(...args){try{return {ok:true,value:await this.#owner(...args)}}catch(error){return {ok:false,status:error.status||503}}}
 async #owner(action,input,principal){
  let result;switch(action){
   case 'pair':result=this.store.pair(principal,input.scopes);break;
   case 'devices':result=this.store.devices();break;
   case 'approve':result=this.store.approve(input.deviceId,input.confirmation);break;
   case 'revoke':result=this.store.revoke(input.deviceId);break;
   case 'submit':result=this.store.submit(input);break;
   case 'task':result=this.store.task(input.jobId);break;
   default:throw Object.assign(Error('Operação inválida.'),{status:400});
  }await this.ctx.storage.setAlarm(Date.now()+60000);return result;
 }
 async device(...args){try{return {ok:true,value:await this.#device(...args)}}catch(error){return {ok:false,status:error.status||503}}}
 async #device(action,input){let result;switch(action){case 'claim':result=this.store.claim(input.ticket,input.name);break;case 'poll':result=this.store.poll(input.deviceId,input.deviceToken);break;case 'complete':result=this.store.complete(input.deviceId,input.deviceToken,input);break;default:throw Object.assign(Error('Operação inválida.'),{status:400});}await this.ctx.storage.setAlarm(Date.now()+60000);return result;}
 async alarm(){this.store.sweep();const active=this.store.one('SELECT COUNT(*) AS n FROM devices').n+this.store.one('SELECT COUNT(*) AS n FROM pairs').n+this.store.one('SELECT COUNT(*) AS n FROM jobs').n;if(active)await this.ctx.storage.setAlarm(Date.now()+60000);}
}
