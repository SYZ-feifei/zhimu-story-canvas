import { DEVELOPMENT_ORDER, beatNode } from './story.js';
import { button, escape, icon } from './ui.js';

export function projectHome(projects) {
  return `<div class="home-inner">
    <section class="home-intro"><div><h1>你的剧本项目</h1><p>从故事梗概开始，或导入已有剧本拆解结构。</p>
      <div class="home-actions">${button('new-project', '新建项目', { glyph: 'plus', style: 'primary' })}${button('script-import', '导入剧本', { glyph: 'upload-simple' })}</div></div>
      <div class="home-art" aria-hidden="true"><img src="/assets/syz.png" alt=""></div></section>
    <div class="home-list-header"><h2>项目 <span>${projects.length}</span></h2>${button('import', '导入项目备份', { glyph: 'archive', style: 'light compact' })}</div>
    <div class="home-projects">${projects.map(project => {
      const complete = DEVELOPMENT_ORDER.filter(beat => beatNode(project, beat)).length;
      return `<button type="button" class="home-project" data-action="select-project" data-id="${escape(project.id)}">
        <div class="home-project-cover${project.cover === 'rain' ? ' rain' : ''}">${project.cover === 'rain' ? '<span class="home-sample">示例</span>' : icon(project.sourceName ? 'file-text' : 'graph')}</div>
        <div class="home-project-content"><div class="home-project-title"><strong>${escape(project.title)}</strong>${icon('arrow-up-right')}</div>
          <p>${escape(project.premise || '打开画布，继续添加故事节点。')}</p><span class="home-project-meta">${project.format} · ${project.nodes.length} 个节点 · ${complete}/4 拍锁定</span></div></button>`;
    }).join('')}</div></div>`;
}
