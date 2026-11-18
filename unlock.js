'use strict';
const $=s=>document.querySelector(s);
const decode=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));
const textDecoder=new TextDecoder();
let encrypted=null, files=null,urls=new Map(),pageUrls=new Map();
const status=(s,error=false)=>{$('#status').textContent=s;$('#status').classList.toggle('error',error);};
function release(){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();pageUrls.clear();files=null;}
function blob(value,type){return URL.createObjectURL(new Blob([value],{type}));}
function replaceAssets(s){for(const [name,url] of [...urls].sort((a,b)=>b[0].length-a[0].length))s=s.split(name).join(url);return s;}
function prepare(bundle){
 files=bundle.files;
 for(const [name,f]of Object.entries(files))if(f.type.startsWith('image/'))urls.set(name,blob(decode(f.base64),f.type));
 for(const name of ['index.html','looks.html']){
  let html=replaceAssets(textDecoder.decode(decode(files[name].base64)));
  const bridge=`<script>let wardrobeHash='#home';Object.defineProperty(window,'__wardrobeHash',{get:()=>wardrobeHash,set:value=>{wardrobeHash=value.startsWith('#')?value:'#'+value;window.dispatchEvent(new Event('hashchange'));}});document.addEventListener('click',function(e){const a=e.target.closest('a');if(!a)return;const h=a.getAttribute('href');if(h==='index.html'||h==='looks.html'){e.preventDefault();parent.postMessage({type:'wardrobe-page',page:h},${JSON.stringify(location.origin)});}else if(h&&h.startsWith('#')){e.preventDefault();window.__wardrobeHash=h;}else if(h&&h.startsWith('blob:')){e.preventDefault();const d=document.createElement('dialog');d.setAttribute('aria-label','试穿大图');d.style.cssText='max-width:96vw;max-height:95vh;border:0;border-radius:8px;padding:12px;background:#f6f4ed';const close=document.createElement('button');close.textContent='关闭大图 ×';close.style.cssText='display:block;margin:0 0 10px auto;padding:10px;border:1px solid #a8b79a;border-radius:4px;background:white;color:#294b35;font-size:16px';close.onclick=()=>d.close();const img=document.createElement('img');img.src=h;img.alt=a.getAttribute('aria-label')||'试穿参考大图';img.style.cssText='display:block;max-width:100%;max-height:78vh;object-fit:contain;margin:auto';d.append(close,img);d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();}});<\/script>`;
  html=html.replace('<head>','<head>'+bridge);
  html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+textDecoder.decode(decode(files['style.css'].base64))+'</style>');
  for(const script of ['data.js','core.js','app.js']){
   let code=replaceAssets(textDecoder.decode(decode(files[script].base64)));
   if(script==='app.js')code=code.split('location.hash').join('window.__wardrobeHash');
   html=html.replace(`<script defer src="${script}"></script>`,'');
   if(name==='index.html')html=html.replace('</body>','<script>'+code.replace(/<\/script/gi,'<\\/script')+'<\/script></body>');
  }
  pageUrls.set(name,html);
 }
}
function showPage(name){if(!pageUrls.has(name))return;$('#content').srcdoc=pageUrls.get(name);$('#gate').hidden=true;$('#viewer').hidden=false;}
async function fetchBundle(config){
 if(encrypted)return encrypted;
 const response=await fetch(config.file);if(!response.ok)throw new Error('download');
 const reader=response.body?.getReader();if(!reader){encrypted=await response.arrayBuffer();return encrypted;}
 const parts=[];let total=0;$('#progress').hidden=false;$('#progress').max=config.bytes;
 while(true){const {done,value}=await reader.read();if(done)break;parts.push(value);total+=value.length;$('#progress').value=total;status(`正在准备衣橱照片 · ${Math.min(100,Math.round(total/config.bytes*100))}%`);}
 const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}encrypted=bytes.buffer;return encrypted;
}
async function open(key,config){
 const bytes=await fetchBundle(config);status('正在解锁照片…');
 let packed;try{packed=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(config.iv)},key,bytes);}catch{throw new Error('password');}
 const stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
 const bundle=JSON.parse(await new Response(stream).text());
 if(bundle.version!==1||!bundle.files?.['index.html'])throw new Error('format');
 prepare(bundle);$('#password').value='';showPage('index.html');status('');
}
$('#unlock-form').addEventListener('submit',async e=>{
 e.preventDefault();$('#unlock-button').disabled=true;status('正在准备衣橱…');
 try{
  if(!window.isSecureContext||!crypto.subtle||typeof DecompressionStream==='undefined')throw new Error('browser');
  const response=await fetch('config.json',{cache:'no-store'});if(!response.ok)throw new Error('download');const config=await response.json();
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode($('#password').value.trim()),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:decode(config.salt),iterations:config.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
  await open(key,config);
 }catch(error){release();status(error.message==='password'?'口令不正确，请检查后再试。':error.message==='browser'?'请在最新版 Safari、Chrome 或 Edge 中打开这个链接。':'暂时没能打开衣橱，请检查网络后重试。',true);}
 finally{$('#unlock-button').disabled=false;$('#progress').hidden=true;}
});
$('#show-password').addEventListener('click',()=>{const showing=$('#password').type==='password';$('#password').type=showing?'text':'password';$('#show-password').textContent=showing?'隐藏':'显示';$('#show-password').setAttribute('aria-pressed',String(showing));});
$('#lock-button').addEventListener('click',()=>{$('#content').srcdoc='';$('#viewer').hidden=true;$('#gate').hidden=false;release();$('#password').value='';status('已上锁。');$('#password').focus();});
$('#home-button').addEventListener('click',()=>showPage('index.html'));
$('#album-button').addEventListener('click',()=>showPage('looks.html'));
window.addEventListener('message',e=>{if(e.source===$('#content').contentWindow&&e.origin===location.origin&&e.data?.type==='wardrobe-page')showPage(e.data.page);});
