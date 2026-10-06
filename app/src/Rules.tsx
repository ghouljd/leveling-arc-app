import React from 'react';
import rules from '../../Docs/REGLAS_WINTER_ARC.md?raw';
import {localDay} from './storage';
function inline(text:string){return text.split(/(\*\*.*?\*\*|`.*?`)/g).map((part,i)=>part.startsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith('`')?<code key={i}>{part.slice(1,-1)}</code>:part);}
export function Rules(){
 const blocks=rules.trim().split(/\n\n+/),today=localDay(),number=Math.floor((Date.parse(today)-Date.parse('2026-10-05'))/86400000)+1;
 return <section><h1>Temporada y reglas</h1><p>5 de octubre–31 de diciembre de 2026 · 88 días · Bogotá.</p><p role="status">{number<1?'Temporada por comenzar':number>88?'Temporada terminada':`Día ${number} de 88`}</p>{blocks.map((block,i)=>{
 const lines=block.split('\n');
 if(block.startsWith('|')){const rows=lines.filter(line=>!/^\|[\s:|\-]+\|$/.test(line)).map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));return <div className="table-scroll" key={i}><table><thead><tr>{rows[0].map((cell,j)=><th key={j} scope="col">{inline(cell)}</th>)}</tr></thead><tbody>{rows.slice(1).map((row,k)=><tr key={k}>{row.map((cell,j)=><td key={j}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;}
 if(block.startsWith('### '))return <h3 key={i}>{inline(block.slice(4))}</h3>;
 if(block.startsWith('## '))return <h2 key={i}>{inline(block.slice(3))}</h2>;
 if(block.startsWith('# '))return null;
 if(lines.every(line=>line.startsWith('- ')))return <ul key={i}>{lines.map((line,j)=><li key={j}>{inline(line.slice(2))}</li>)}</ul>;
 return <p key={i}>{inline(block)}</p>;
 })}</section>;
}
