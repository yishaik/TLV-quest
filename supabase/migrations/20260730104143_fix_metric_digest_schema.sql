do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'private.upsert_anonymous_run_metric(uuid)'::regprocedure
  ) into v_definition;

  execute replace(
    v_definition,
    'public.digest(p_run_id::text, ''sha256'')',
    'extensions.digest(p_run_id::text, ''sha256'')'
  );
end;
$$;
