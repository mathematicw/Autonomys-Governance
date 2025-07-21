import sqlite3


def run_init_sql():
    connection_obj = sqlite3.connect('governance.db')
    cursor_obj = connection_obj.cursor()

    cursor_obj.execute("PRAGMA foreign_keys = ON;")

    tables = [
        """
        CREATE TABLE IF NOT EXISTS PROPOSAL (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            Initiator TEXT NOT NULL,
            Name TEXT NOT NULL,
            Voted BOOLEAN DEFAULT 0,
            DateUpdated TEXT,
            DateCreated TEXT
        );
        """
    ]

    for table in tables:
        cursor_obj.execute(table)

    connection_obj.commit()
    connection_obj.close()