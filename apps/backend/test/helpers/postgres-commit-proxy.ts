import assert from 'node:assert/strict';
import {createServer,connect,type Socket} from 'node:net';

// Test-only plaintext loopback transport barrier. Never record startup/auth
// packets; forward them unchanged. The upstream is fixed to local test PG.
export async function postgresCommitProxy(){
 const sockets=new Set<Socket>();let armed:null|{mode:'hold'|'drop-ack';resolve:(v:{pid:number;release:()=>void;commitAckObserved:boolean})=>void}=null;
 const server=createServer(front=>{
  const back=connect({host:'127.0.0.1',port:55432});sockets.add(front);sockets.add(back);let client=Buffer.alloc(0),backend=Buffer.alloc(0),startup=true,pid=0,held:Buffer[]|null=null,drop=false;
  const destroy=()=>{front.destroy();back.destroy();sockets.delete(front);sockets.delete(back);};front.on('error',destroy);back.on('error',destroy);front.on('close',destroy);back.on('close',destroy);
  let commitWaiter:typeof armed=null;
  front.on('data',chunk=>{client=Buffer.concat([client,chunk]);for(;;){if(startup){if(client.length<4)return;const n=client.readInt32BE(0);if(client.length<n)return;const packet=client.subarray(0,n);client=client.subarray(n);if(n===8&&packet.readInt32BE(4)===80877103){front.write('N');continue;}startup=false;back.write(packet);continue;}
   if(client.length<5)return;const n=1+client.readInt32BE(1);if(client.length<n)return;const packet=client.subarray(0,n);client=client.subarray(n);if(held){held.push(packet);continue;}
   const type=String.fromCharCode(packet[0]);let sql='';if(type==='Q')sql=packet.subarray(5,-1).toString();else if(type==='P'){const end=packet.indexOf(0,5);sql=packet.subarray(end+1,packet.indexOf(0,end+1)).toString();}
   if(armed&&/^\s*COMMIT\s*;?\s*$/i.test(sql)){assert(pid>0);commitWaiter=armed;armed=null;if(commitWaiter.mode==='hold'){held=[packet];commitWaiter.resolve({pid,commitAckObserved:false,release:()=>{if(held){const bytes=Buffer.concat(held);held=null;back.write(bytes);}}});continue;}drop=true;}
   back.write(packet);
  }});
  back.on('data',chunk=>{backend=Buffer.concat([backend,chunk]);for(;;){if(backend.length<5)return;const n=1+backend.readInt32BE(1);if(backend.length<n)return;const packet=backend.subarray(0,n);backend=backend.subarray(n);const type=String.fromCharCode(packet[0]);if(type==='K')pid=packet.readInt32BE(5);
   if(drop&&type==='C'&&packet.subarray(5,-1).toString()==='COMMIT'){commitWaiter!.resolve({pid,commitAckObserved:true,release:()=>{}});destroy();return;}front.write(packet);
  }});
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address!=='string');
 return {port:address.port,arm(mode:'hold'|'drop-ack'){assert.equal(armed,null);return new Promise<{pid:number;release:()=>void;commitAckObserved:boolean}>(resolve=>{armed={mode,resolve};});},async close(){for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
