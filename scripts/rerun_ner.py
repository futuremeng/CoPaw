#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
重新生成项目 NER 数据的脚本
Usage: python scripts/rerun_ner.py <project_id>
"""

import json
import sys
from pathlib import Path
from copaw.config.config import Config, KnowledgeSourceSpec
from copaw.knowledge.manager import KnowledgeManager


def rerun_project_ner(project_id: str):
    """重新生成指定项目的 NER 数据"""
    
    # 项目路径
    workspace_dir = Path.home() / ".copaw" / "workspaces" / "default"
    project_dir = workspace_dir / "projects" / project_id
    
    if not project_dir.exists():
        print(f"❌ 项目目录不存在: {project_dir}")
        sys.exit(1)
    
    print(f"📁 项目目录: {project_dir}")
    
    # 加载配置
    config = Config()
    knowledge_config = config.knowledge
    
    # 检查 HanLP 是否启用
    if not knowledge_config.hanlp.enabled:
        print("⚠️  HanLP 未启用，请在配置中启用 hanlp.enabled")
        sys.exit(1)
    
    print(f"✅ HanLP 已启用")
    
    # 创建知识管理器
    manager = KnowledgeManager(
        project_dir,
        knowledge_dirname=".knowledge"
    )
    
    # 构建项目源
    source = KnowledgeSourceSpec(
        id=f"project-{project_id}-workspace",
        name=f"Project Workspace: {project_id}",
        type="directory",
        location=str(project_dir),
        content="",
        enabled=True,
        recursive=True,
        project_id=project_id,
        tags=["project"],
        summary=f"Project-scoped knowledge source for {project_id}"
    )
    
    print(f"🔄 开始重新索引项目知识...")
    print(f"   源 ID: {source.id}")
    print(f"   位置: {source.location}")
    
    try:
        # 执行索引（这会触发 NER 处理）
        result = manager.index_source(source, knowledge_config)
        
        print(f"\n✅ 索引完成!")
        print(f"   文档数: {result.get('document_count', 0)}")
        print(f"   分块数: {result.get('chunk_count', 0)}")
        
        # 检查 NER 结果
        chunks = result.get('chunks', [])
        ner_ready_count = sum(1 for chunk in chunks if chunk.get('ner_status') == 'ready')
        ner_entity_count = sum(chunk.get('ner_entity_count', 0) for chunk in chunks)
        
        print(f"\n📊 NER 统计:")
        print(f"   就绪文档数: {ner_ready_count}")
        print(f"   实体总数: {ner_entity_count}")
        
        # 检查实体类型分布
        entity_types = {}
        for chunk in chunks:
            if chunk.get('ner_status') != 'ready':
                continue
            
            # 读取 NER 结构化文件
            ner_structured_path = manager.root_dir / chunk.get('ner_structured_path', '')
            if ner_structured_path.exists():
                with open(ner_structured_path, 'r', encoding='utf-8') as f:
                    ner_data = json.load(f)
                
                # 统计实体类型
                for mention in ner_data.get('entity_mentions', []):
                    label = mention.get('label', 'unknown')
                    entity_types[label] = entity_types.get(label, 0) + 1
        
        if entity_types:
            print(f"\n🏷️  实体类型分布:")
            for label, count in sorted(entity_types.items(), key=lambda x: x[1], reverse=True):
                print(f"   {label}: {count}")
            
            # 检查是否有 semantic_token
            if 'semantic_token' in entity_types:
                print(f"\n⚠️  警告: 发现 {entity_types['semantic_token']} 个 semantic_token 类型的实体")
                print(f"   这表明 HanLP NER 可能未正确工作")
            else:
                print(f"\n✅ 所有实体都有真实的类型标签（无 semantic_token）")
        else:
            print(f"\n⚠️  未找到任何实体")
        
        # 显示示例
        print(f"\n📝 示例实体（前5个）:")
        example_count = 0
        for chunk in chunks:
            if chunk.get('ner_status') != 'ready' or example_count >= 5:
                continue
            
            ner_structured_path = manager.root_dir / chunk.get('ner_structured_path', '')
            if ner_structured_path.exists():
                with open(ner_structured_path, 'r', encoding='utf-8') as f:
                    ner_data = json.load(f)
                
                for mention in ner_data.get('entity_mentions', [])[:5]:
                    print(f"   - {mention.get('surface', '')} [{mention.get('label', 'unknown')}]")
                    example_count += 1
                    if example_count >= 5:
                        break
        
        print(f"\n✨ 完成！请检查上述输出确认实体类型是否正确")
        
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python scripts/rerun_ner.py <project_id>")
        print("示例: python scripts/rerun_ner.py project-2ZHU4d")
        sys.exit(1)
    
    project_id = sys.argv[1]
    rerun_project_ner(project_id)
