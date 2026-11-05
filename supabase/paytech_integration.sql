-- ====================================================================
-- INTÉGRATION PAYTECH SÉNÉGAL – FONCTION DE VALIDATION PAR RÉFÉRENCE
-- ====================================================================

-- Permet de valider un paiement et d'allouer les crédits directement à partir
-- de la référence de commande (ref_command) retournée par le Webhook IPN PayTech.

create or replace function public.complete_payment_by_ref(
  p_ref_command text,
  p_external_token text default null
)
returns jsonb
language plpgsql
security definer
as $func$
declare
  v_payment_id uuid;
begin
  select id into v_payment_id
  from public.payments
  where reference_externe = p_ref_command
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Paiement introuvable pour la référence ' || coalesce(p_ref_command, ''));
  end if;

  if p_external_token is not null then
    update public.payments
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('paytech_token', p_external_token)
    where id = v_payment_id;
  end if;

  return public.complete_payment(v_payment_id);
end;
$func$;

grant execute on function public.complete_payment_by_ref(text, text) to anon, authenticated, service_role;
