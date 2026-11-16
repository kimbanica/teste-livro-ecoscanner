(()=>{'use strict';
const c=window.LIVRO_CONFIG||{},$=id=>document.getElementById(id);
let flip=null,pdf=null,current=0,total=0,endPage=0,soundOn=false,lastSound=0,linear=false,rendering=new Map(),pages=[],renderQueue=[],activeRenders=0,ready=false;
const MAX_RENDER=2;const pdfURL=c.pdf||'documentos/projeto.pdf';
document.documentElement.style.setProperty('--ink',c.cor||'#173b36');document.documentElement.style.setProperty('--accent',c.cor2||'#d9bd82');
function text(id,s){$(id).textContent=s||''}
text('heading',c.titulo);text('subtitle',c.subtitulo);text('institution',c.instituicao);text('course',c.curso);text('schoolYear',(c.cidade||'')+' • '+(c.ano||''));text('coverSchool',c.instituicao+' · '+c.curso);text('coverTitle',c.titulo);text('coverSub',c.subtitulo);text('coverAuthors',(c.autores||[]).join(' • '));text('coverMentor','Orientação: '+(c.orientador||''));text('coverCity',(c.cidade||'')+' • '+(c.ano||''));text('footer',(c.licenca||'')+' | '+(c.ano||''));document.title=(c.titulo||'Livro digital')+' | Livro digital';$('pdfLink').href=pdfURL;if(c.previewSession){$('pdfLink').addEventListener('click',e=>{e.preventDefault();if(window.opener)window.opener.postMessage({type:'BOOK_OPEN_ORIGINAL',session:c.previewSession},'*')});}
function link(id,url){if(url&&/^https?:\/\//i.test(url))$(id).href=url;else {$(id).removeAttribute('href');$(id).classList.add('linkDisabled');$(id).title='Não configurado'}}
link('repoLink',c.repositorio);link('appLink',c.aplicacao);link('videoLink',c.video);
const theme=c.temaCapa||'academica';const cover=$('cover');cover.classList.add('theme-'+theme);
if(c.logoTema && theme==='academica'){$('themeLogo').src=c.logoTema;$('themeLogo').hidden=false}
if(c.capa){const artwork=$('coverArtwork');artwork.src=c.capa;artwork.hidden=false;cover.classList.add('hasCoverArtwork');}
// A capa exportada é uma imagem final gerada pelo painel. Não sobrepor texto.
if(c.capa){cover.classList.add('coverRendered');}

const audio=new Audio(c.audio||'https://upload.wikimedia.org/wikipedia/commons/6/6b/Turning_a_page.ogg');audio.preload='none';audio.volume=.68;audio.playbackRate=1.65;
function play(force=false){if(!soundOn&&!force)return;let now=performance.now();if(!force&&now-lastSound<650)return;lastSound=now;try{audio.pause();audio.currentTime=0;audio.play().catch(()=>message('O áudio não pôde ser reproduzido. Conecte à internet ou escolha um arquivo de áudio no painel.'));}catch(e){}}
function message(s){$('warning').style.display='block';$('warning').textContent=s}
function loadingProgress(p,label){const progress=$('loadProgress');if(!progress)return;const n=Math.min(100,Math.max(0,Math.round(p)));progress.hidden=false;progress.setAttribute('aria-valuenow',String(n));$('loadProgressFill').style.width=n+'%';$('loadProgressText').textContent=n+'%';if(label)text('status',label+' · '+n+'%')}
/* Prévia local: recebe os bytes PDF diretamente do painel que abriu esta janela.
   Não tenta buscar o blob:null por HTTP, pois file:// e blob:null têm origem opaca. */
function receberPDFDaPrevia(){
 return new Promise((resolve,reject)=>{
  if(!window.opener){reject(new Error('A janela do painel não está disponível. Reabra o livro pelo painel.'));return;}
  const session=c.previewSession;
  const deadline=setTimeout(()=>{window.removeEventListener('message',onMessage);reject(new Error('O painel não enviou o PDF. Reabra a prévia.'));},45000);
  function onMessage(event){
   if(event.source!==window.opener||!event.data||event.data.session!==session)return;
   const msg=event.data;
   if(msg.type==='BOOK_PDF_PROGRESS'){
    loadingProgress(4+54*Math.max(0,Math.min(1,Number(msg.ratio)||0)),'Lendo PDF selecionado');
   }else if(msg.type==='BOOK_PDF_BYTES'){
    clearTimeout(deadline);window.removeEventListener('message',onMessage);
    if(msg.buffer instanceof ArrayBuffer)resolve(new Uint8Array(msg.buffer));
    else reject(new Error('Os dados do PDF não puderam ser recebidos.'));
   }else if(msg.type==='BOOK_PDF_ERROR'){
    clearTimeout(deadline);window.removeEventListener('message',onMessage);
    reject(new Error(msg.error||'Falha ao ler o PDF selecionado.'));
   }
  }
  window.addEventListener('message',onMessage);
  window.opener.postMessage({type:'BOOK_PDF_REQUEST',session},'*');
 });
}

function showFallback(){
 const linearView=$('linearView'),frame=$('pdfFrame');
 if(linearView)linearView.style.display='block';
 if(frame&&!frame.getAttribute('src')&&!c.previewDirect&&!c.previewSession){frame.src=pdfURL+'#toolbar=1';}
 if($('loadProgress'))$('loadProgress').hidden=true;
 text('status','Capa pronta · PDF disponível para leitura');
}
function loadingComplete(){ready=true;loadingProgress(100,'Livro pronto para folhear');setTimeout(()=>{$('loadProgress').hidden=true;update(current)},800)}
function update(n){current=Math.max(0,Math.min(endPage||total,n));$('prev').disabled=current<=0;$('next').disabled=current>=(endPage||total);if(ready)text('status',current===0?'Capa · '+total+' páginas do documento':current>total?'Contracapa · '+c.titulo:`Página ${current} de ${total} · ${c.titulo||''}`);$('pageNo').value=Math.min(total,Math.max(1,current));if(!linear)renderNear(current)}
function render(n){if(!pdf||n<1||n>total)return Promise.resolve();const el=pages[n];if(!el||el.dataset.done)return Promise.resolve();if(rendering.has(n))return rendering.get(n);const job=new Promise(resolve=>{renderQueue.push({n,el,resolve});pump();});rendering.set(n,job);return job;}
async function pump(){while(activeRenders<MAX_RENDER && renderQueue.length){const {n,el,resolve}=renderQueue.shift();activeRenders++;(async()=>{try{const pg=await pdf.getPage(n);const viewport=pg.getViewport({scale:1.12});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('aria-label','Imagem da página '+n+'; utilize o PDF original para leitura acessível');await pg.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport}).promise;el.replaceChildren(canvas);el.dataset.done='1';}catch(e){el.textContent='Não foi possível exibir a página '+n}finally{rendering.delete(n);activeRenders--;resolve();pump()}})();}}
function renderNear(n){const targets=[];for(let j=Math.max(1,n);j<=Math.min(total,n+2);j++)targets.push(j);for(let j=Math.max(1,n-2);j<n;j++)targets.push(j);for(let j=n+3;j<=Math.min(total,n+4);j++)targets.push(j);targets.forEach(render)}
function go(n){n=Math.max(0,Math.min(endPage||total,Number(n)||0));if(flip){if(matchMedia('(prefers-reduced-motion: reduce)').matches)flip.turnToPage(n);else flip.flip(n)}else{play();update(n)}}
function toggleLinear(force){linear=typeof force==='boolean'?force:!linear;$('stage').style.display=linear?'none':'flex';$('linearView').style.display=linear?'block':'none';$('linear').textContent=linear?'📖 Voltar ao livro':'☷ Leitura linear';if(linear&&!$('pdfFrame').src){if(c.previewSession){$('pdfFrame').srcdoc='<p style="font:16px system-ui;padding:24px">Para leitura linear, clique em <strong>Abrir PDF original</strong> acima.</p>';}else{$('pdfFrame').src=pdfURL+'#toolbar=1';}}}
$('prev').onclick=()=>go(current-1);$('next').onclick=()=>go(current+1);$('first').onclick=()=>go(0);$('last').onclick=()=>go(endPage||total);$('goPage').onclick=()=>go($('pageNo').value);$('pageNo').onkeydown=e=>{if(e.key==='Enter')go(e.target.value)};$('toc').onchange=e=>go(e.target.value);$('linear').onclick=()=>toggleLinear();$('contrast').onclick=()=>{let on=document.body.classList.toggle('contrast');$('contrast').setAttribute('aria-pressed',String(on))};$('zoom').onclick=()=>{let on=document.body.classList.toggle('large');$('zoom').textContent=on?'A− Tamanho normal':'A+ Ampliar';if(!linear)toggleLinear(true)};
$('sound').onclick=()=>{soundOn=!soundOn;$('sound').textContent=soundOn?'🔊 Som ligado':'🔇 Ativar som';$('sound').setAttribute('aria-pressed',String(soundOn));if(!soundOn)audio.pause()};$('test').onclick=()=>play(true);window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;if(e.key==='ArrowLeft')go(current-1);if(e.key==='ArrowRight')go(current+1)});
async function init(){loadingProgress(2,'Capa pronta; preparando documento');if(!window.pdfjsLib){message('Não foi possível carregar o visualizador animado. Use o botão Abrir PDF original.');$('loadProgress').hidden=true;return}try{pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';let pdfSource;
if(c.previewDirect && window.__PREVIEW_PDF_B64){
  loadingProgress(12,'Lendo PDF selecionado');
  const binary=atob(window.__PREVIEW_PDF_B64);
  const data=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)data[i]=binary.charCodeAt(i);
  window.__PREVIEW_PDF_B64=null;
  loadingProgress(55,'PDF recebido; preparando visualização');
  pdfSource={data};
}else if(c.previewSession){pdfSource={data:await receberPDFDaPrevia()}}
else{pdfSource={url:pdfURL,disableAutoFetch:true,disableStream:false}}
const loading=pdfjsLib.getDocument(pdfSource);loading.onProgress=({loaded,total:bytes})=>{const expected=bytes||Number(c.tamanhoPDF)||0;if(expected){loadingProgress(c.previewDirect?Math.max(55,5+55*Math.min(1,loaded/expected)):5+55*Math.min(1,loaded/expected),'Carregando PDF');}else{text('status','Baixando PDF: '+Math.round(loaded/1024)+' KB recebidos (tamanho total indisponível)');}};pdf=await loading.promise;total=pdf.numPages;endPage=total+(c.contracapa?1:0);loadingProgress(65,'Documento carregado; organizando páginas');const ref=await pdf.getPage(1),vp=ref.getViewport({scale:1});let ratio=vp.height/vp.width,W=405,H=Math.round(W*ratio);for(let n=1;n<=total;n++){let article=document.createElement('article');article.className='page';article.setAttribute('aria-label','Página '+n+' do documento');article.innerHTML='<div class="loader">Carregando página '+n+'…</div>';$('book').appendChild(article)}if(c.contracapa){const back=document.createElement('article');back.className='page backcover';back.dataset.density='hard';back.setAttribute('aria-label','Contracapa do livro');const backImage=document.createElement('img');backImage.alt='Contracapa do projeto';backImage.src=c.contracapa;back.appendChild(backImage);$('book').appendChild(back)}pages=[...$('book').querySelectorAll('.page')];for(const item of c.secoes||[]){let opt=document.createElement('option');opt.value=Number(item.page)||0;opt.textContent=item.title;$('toc').appendChild(opt)}loadingProgress(75,'Preparando a primeira página');await render(1);loadingProgress(90,'Montando animação do livro');if(window.St&&St.PageFlip){try{flip=new St.PageFlip($('book'),{width:W,height:H,size:'stretch',minWidth:215,maxWidth:W,minHeight:Math.round(215*ratio),maxHeight:H,showCover:true,autoSize:true,drawShadow:true,maxShadowOpacity:.33,flippingTime:950,mobileScrollSupport:false,useMouseEvents:true});flip.on('changeState',e=>{if(e.data==='flipping')play()});flip.on('flip',e=>update(e.data));$('book').classList.remove('loading-cover');flip.loadFromHTML(pages);update(0);renderNear(1)}catch(e){flip=null;message('O efeito 3D não foi iniciado. Use a leitura linear para visualizar o PDF.')}}else{message('A biblioteca de animação está indisponível. Use a leitura linear.')}if(!flip){showFallback()}loadingComplete()}catch(e){message('Não foi possível abrir o PDF: '+e.message+'. Verifique o documento selecionado no painel. Se o erro persistir, feche a prévia e abra novamente.');$('loadProgress').hidden=true;}}
init();})();
