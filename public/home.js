import { button, escape, icon } from './ui.js';
import { methodFor } from './methods.js';

export function projectHome(projects) {
  return `<div class="home-inner">
    <section class="home-hero" aria-label="枝幕剧本创作">
      <div class="home-hero-content">
        <h1>剧本创作画布</h1>
        <div class="home-actions">${button('new-project', '新建画布', { glyph: 'plus', style: 'primary' })}${button('script-import', '导入剧本', { glyph: 'upload-simple' })}</div>
      </div>
    </section>
    <div class="home-list-header"><h2>我的项目</h2>${button('import', '导入项目备份', { glyph: 'archive', style: 'quiet compact' })}</div>
    <div class="home-projects">${projects.map(project => {
      const premise = project.referenceNodeIds.premise ? project.nodes.find(node => node.id === project.referenceNodeIds.premise)?.script : project.premise;
      const method = methodFor(project.method);
      return `<article class="project-tile">
        <button type="button" class="home-project" data-action="select-project" data-id="${escape(project.id)}">
          <div class="home-project-cover${project.cover === 'rain' ? ' rain' : ''}">${project.cover === 'rain' ? '<span class="home-sample">示例</span>' : icon(project.sourceName ? 'file-text' : 'graph')}</div>
          <div class="home-project-content"><strong>${escape(project.title)}</strong>
            ${premise ? `<p>${escape(premise)}</p>` : ''}
            <span class="home-project-meta">${project.format} · ${project.nodes.length} 个节点${method.id === 'free' ? '' : ` · ${escape(method.name)}`}</span></div>
        </button>
        <button type="button" class="icon-button project-menu" data-action="project-menu" data-id="${escape(project.id)}" aria-label="${escape(project.title)}的项目选项" aria-haspopup="menu">${icon('dots-three')}</button>
      </article>`;
    }).join('') || '<p class="home-empty">创建画布或导入剧本，开始一个项目。</p>'}</div>
  </div>`;
}
