ALTER TYPE "public"."league_role" ADD VALUE 'league_admin' BEFORE 'member';--> statement-breakpoint
ALTER TYPE "public"."league_role" ADD VALUE 'scorekeeper' BEFORE 'member';--> statement-breakpoint
ALTER TYPE "public"."league_role" ADD VALUE 'runner_operator' BEFORE 'member';