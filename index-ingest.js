#!/usr/bin/env node
/**
 * Pre-index lamatrader-ingest documents for vault graph.
 * Scans the extracted/claude directory, reads .md files,
 * extracts titles/headings/previews, writes ingest-index.json.
 */
const fs=require('fs');
const path=require('path');

const INGEST_DIR=path.join(__dirname,'..','lamatrader-ingest','extracted','claude');
const OUT_FILE=path.join(__dirname,'data','ingest-index.json');

const results=[];

function walk(dir){
  let entries=[];
  try{ entries=fs.readdirSync(dir,{withFileTypes:true}); }catch(e){ return; }
  for(const e of entries){
    const full=path.join(dir,e.name);
    if(e.isDirectory()){
      walk(full);
    } else if(e.name.endsWith('.md')){
      try{
        const content=fs.readFileSync(full,'utf8');
        // Extract title from first # heading or filename
        const titleMatch=content.match(/^#\s+(.+)/m);
        const title=titleMatch?titleMatch[1].trim():path.basename(e.name,'.md').replace(/[-_]/g,' ');
        // Extract sections (## headings)
        const sections=[];
        const headingRegex=/^##\s+(.+)$/gm;
        let hMatch;
        while((hMatch=headingRegex.exec(content))!==null){
          const heading=hMatch[1].trim();
          // Get content after this heading until next heading or end
          const nextIdx=content.indexOf('\n## ',hMatch.index+1);
          const sectionContent=nextIdx>=0?content.slice(hMatch.index+content.slice(hMatch.index).indexOf('\n')+1,nextIdx).trim():content.slice(hMatch.index+content.slice(hMatch.index).indexOf('\n')+1).trim();
          sections.push({heading,content:sectionContent.slice(0,300)});
        }
        // Extract keywords from content (common words)
        const words=content.toLowerCase().match(/\b[a-z]{4,}\b/g)||[];
        const freq={};
        for(const w of words){ freq[w]=(freq[w]||0)+1; }
        const keywords=Object.entries(freq)
          .filter(([w,c])=>c>2&&!['this','that','with','from','have','been','were','what','when','where','which','their','there','about','would','could','should','after','before','other','every','still','also','than','then','them','they','your'].includes(w))
          .sort((a,b)=>b[1]-a[1])
          .slice(0,30)
          .map(([w])=>w);

        // Relative path within ingest tree
        const relPath=path.relative(INGEST_DIR,full);

        results.push({
          title,
          path:relPath,
          sections:sections.slice(0,15),
          size:content.length,
          keywords,
          preview:sections.slice(0,2).map(s=>s.content.slice(0,100)).filter(Boolean).join(' | ')||content.slice(0,200).replace(/#/g,'').trim()
        });
      } catch(e){ /* skip unreadable */ }
    }
  }
}

walk(INGEST_DIR);

fs.writeFileSync(OUT_FILE, JSON.stringify({generated:new Date().toISOString(),files:results,fileCount:results.length,totalSize:results.reduce((a,f)=>a+f.size,0)},null,2));
console.log(`Indexed ${results.length} documents -> ${OUT_FILE}`);
