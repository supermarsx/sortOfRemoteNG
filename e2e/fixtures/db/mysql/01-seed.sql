-- t69 e2e seed for `test-mysql` (mysql:8) AND `test-mariadb` (mariadb:11).
-- Mounted at /docker-entrypoint-initdb.d on both containers; both entrypoints
-- run it once against MYSQL_DATABASE / MARIADB_DATABASE (testdb) on first init.
-- Keep the SQL in the MySQL/MariaDB common subset — no engine-specific syntax.

USE testdb;

CREATE TABLE IF NOT EXISTS people (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  city VARCHAR(64) NOT NULL,
  INDEX idx_people_city (city)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO people (id, name, city) VALUES
  (1, 'Ada', 'London'),
  (2, 'Grace', 'Arlington'),
  (3, 'Linus', 'Helsinki'),
  (4, 'Margaret', 'London'),
  (5, 'Dennis', 'New York');

-- Non-empty views / routines so list_views and list_routines return rows.
CREATE OR REPLACE VIEW people_in_london AS
  SELECT id, name FROM people WHERE city = 'London';

DROP PROCEDURE IF EXISTS count_people;
DELIMITER //
CREATE PROCEDURE count_people()
BEGIN
  SELECT COUNT(*) AS total FROM people;
END //
DELIMITER ;

-- Make sure the app user can call the routine and read the view.
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, SHOW VIEW ON testdb.* TO 'testuser'@'%';
FLUSH PRIVILEGES;
