-- منع إضافة مباريات يدوية: المباريات تجي بس من المزامنة التلقائية
drop policy if exists "add match as self" on public.matches;
