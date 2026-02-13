#!/usr/bin/env python3
"""
AI Agent 記憶同步腳本
將 AI agent 會話同步到 Obsidian 知識庫

環境變數:
    MEMORIA_HOME: 專案安裝目錄 (預設為腳本所在目錄的父目錄)
"""

import os
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from uuid import uuid4


def sanitize_filename(name, fallback="untitled"):
    """將檔名清理為安全格式"""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(name))
    cleaned = re.sub(r'\s+', '_', cleaned).strip('._')
    return cleaned or fallback

class MemorySync:
    def __init__(self, memory_path, obsidian_vault):
        self.memory_path = Path(memory_path)
        self.vault = Path(obsidian_vault)
        self.db_path = self.memory_path / "sessions.db"
        
        # 確保目錄存在
        (self.vault / "Daily").mkdir(parents=True, exist_ok=True)
        (self.vault / "Skills").mkdir(parents=True, exist_ok=True)
        (self.vault / "Decisions").mkdir(parents=True, exist_ok=True)
    
    def init_database(self):
        """初始化 SQLite 資料庫"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 創建表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                timestamp DATETIME,
                project TEXT,
                event_count INTEGER,
                summary TEXT
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                timestamp DATETIME,
                event_type TEXT,
                content TEXT,
                metadata TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY,
                name TEXT,
                category TEXT,
                created_date DATETIME,
                success_rate REAL,
                use_count INTEGER,
                filepath TEXT
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def import_session(self, session_file):
        """導入會話到資料庫"""
        with open(session_file, 'r') as f:
            session_data = json.load(f)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 插入會話記錄
        session_id = session_data.get('id', str(datetime.now().timestamp()))
        cursor.execute('''
            INSERT OR REPLACE INTO sessions 
            (id, timestamp, project, event_count, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (
            session_id,
            session_data.get('timestamp', datetime.now().isoformat()),
            session_data.get('project', 'default'),
            len(session_data.get('events', [])),
            session_data.get('summary', '')
        ))
        
        # 插入事件
        for event in session_data.get('events', []):
            event_id = event.get('id') or f"evt_{uuid4().hex}"
            cursor.execute('''
                INSERT OR REPLACE INTO events
                (id, session_id, timestamp, event_type, content, metadata)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                event_id,
                session_id,
                event.get('timestamp', ''),
                event.get('type', ''),
                json.dumps(event.get('content', {})),
                json.dumps(event.get('metadata', {}))
            ))
        
        conn.commit()
        conn.close()
        
        return session_id
    
    def sync_to_daily_note(self, session_id):
        """同步到每日筆記"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 獲取會話信息
        cursor.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
        session = cursor.fetchone()
        
        if not session:
            return
        
        _, timestamp, project, event_count, summary = session
        date = datetime.fromisoformat(timestamp).strftime('%Y-%m-%d')
        
        # 創建或更新每日筆記
        daily_note_path = self.vault / "Daily" / f"{date}.md"
        
        # 讀取現有內容（如果存在）
        existing_content = ""
        if daily_note_path.exists():
            with open(daily_note_path, 'r') as f:
                existing_content = f.read()
        
        # 添加新會話記錄
        session_time = datetime.fromisoformat(timestamp).strftime('%H:%M')
        new_entry = f"\n## {session_time} - {project}\n\n"
        new_entry += f"{summary}\n\n"
        new_entry += f"事件數: {event_count} | Session ID: `{session_id}`\n"
        
        # 寫入文件
        if existing_content:
            # 如果已存在，追加到末尾
            content = existing_content + new_entry
        else:
            # 創建新文件
            content = f"# {date}\n\n" + new_entry
        
        with open(daily_note_path, 'w') as f:
            f.write(content)
        
        conn.close()
        print(f"✓ 已同步到每日筆記: {daily_note_path}")
    
    def extract_decisions(self, session_id):
        """提取決策到決策日誌"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 查找決策事件
        cursor.execute('''
            SELECT * FROM events 
            WHERE session_id = ? AND event_type = 'DecisionMade'
        ''', (session_id,))
        
        decisions = cursor.fetchall()
        
        for decision in decisions:
            _, _, timestamp, _, content, metadata = decision
            content_data = json.loads(content)
            
            decision_title = content_data.get('decision', 'Untitled Decision')
            decision_slug = sanitize_filename(decision_title)[:30]
            decision_file = self.vault / "Decisions" / f"{timestamp.split('T')[0]}_{decision_slug}_{uuid4().hex[:8]}.md"
            
            # 創建決策文檔
            decision_content = f"""# {decision_title}

## 元數據
- **日期**: {timestamp}
- **Session ID**: `{session_id}`

## 決策內容
{content_data.get('decision', '')}

## 理由
{content_data.get('rationale', '')}

## 考慮的替代方案
{chr(10).join(f'- {alt}' for alt in content_data.get('alternatives_considered', []))}

## 影響等級
{content_data.get('impact_level', 'medium')}

## 相關連結
[[{timestamp.split('T')[0]}]]
"""
            
            with open(decision_file, 'w') as f:
                f.write(decision_content)
            
            print(f"✓ 已提取決策: {decision_file}")
        
        conn.close()
    
    def extract_skills(self, session_id):
        """提取技能到技能庫"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 查找技能學習事件
        cursor.execute('''
            SELECT * FROM events 
            WHERE session_id = ? AND event_type = 'SkillLearned'
        ''', (session_id,))
        
        skills = cursor.fetchall()
        
        for skill in skills:
            _, _, timestamp, _, content, metadata = skill
            content_data = json.loads(content)
            
            skill_name = content_data.get('skill_name', 'Untitled Skill')
            skill_file = self.vault / "Skills" / f"{sanitize_filename(skill_name)}.md"
            
            # 創建或更新技能文檔
            skill_content = f"""# {skill_name}

## 元數據
- **創建日期**: {timestamp}
- **類別**: {content_data.get('category', 'general')}
- **成功率**: {content_data.get('success_rate', 0):.1%}
- **使用次數**: 1

## 模式描述
{content_data.get('pattern', '')}

## 實際案例
{chr(10).join(f'- {ex}' for ex in content_data.get('examples', []))}

## 版本歷史
- v1.0 ({timestamp.split('T')[0]}): 初始版本
"""
            
            with open(skill_file, 'w') as f:
                f.write(skill_content)
            
            # 記錄到資料庫
            cursor.execute('''
                INSERT OR REPLACE INTO skills
                (id, name, category, created_date, success_rate, use_count, filepath)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                skill_name.lower().replace(' ', '_'),
                skill_name,
                content_data.get('category', 'general'),
                timestamp,
                content_data.get('success_rate', 0),
                1,
                str(skill_file)
            ))
            
            conn.commit()
            print(f"✓ 已提取技能: {skill_file}")
        
        conn.close()

def main():
    import sys
    
    if len(sys.argv) < 2:
        print("使用方法: python sync_memory.py <session-file.json>")
        print("或: python sync_memory.py --init  (初始化資料庫)")
        print("")
        print("提示: 請設定 MEMORIA_HOME 環境變數指向專案目錄")
        print("  export MEMORIA_HOME=/path/to/Memoria")
        sys.exit(1)
    
    # 配置路徑 - 優先使用環境變數,否則使用腳本所在目錄
    memoria_home = os.getenv('MEMORIA_HOME')
    
    if memoria_home:
        # 使用環境變數指定的路徑
        base_path = Path(memoria_home)
    else:
        # 回退到腳本所在目錄（若是 scripts 目錄則回退父目錄）
        script_dir = Path(__file__).parent.resolve()
        if (script_dir / ".memory").exists() or (script_dir / "knowledge").exists():
            base_path = script_dir
        else:
            base_path = script_dir.parent
        print(f"⚠️  未設定 MEMORIA_HOME 環境變數,使用預設路徑: {base_path}")
    
    memory_path = base_path / ".memory"
    vault_path = base_path / "knowledge"
    
    sync = MemorySync(memory_path, vault_path)
    
    if sys.argv[1] == '--init':
        sync.init_database()
        print("✓ 資料庫已初始化")
    else:
        session_file = sys.argv[1]
        
        # 導入會話
        session_id = sync.import_session(session_file)
        print(f"✓ 已導入會話: {session_id}")
        
        # 同步到各個位置
        sync.sync_to_daily_note(session_id)
        sync.extract_decisions(session_id)
        sync.extract_skills(session_id)
        
        print("\n✅ 同步完成!")

if __name__ == "__main__":
    main()
