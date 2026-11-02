DO $$
BEGIN
	IF EXISTS (
		SELECT lower(username) FROM users GROUP BY lower(username) HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot add case-insensitive username uniqueness: duplicate usernames require an operator-reviewed resolution.';
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" USING btree (lower("username"));
