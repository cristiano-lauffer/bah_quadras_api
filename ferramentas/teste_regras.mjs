// Teste das regras de cancelamento, reembolso, bloqueio e do painel do admin.
// uso: node ferramentas/teste_regras.mjs [http://localhost:3000]   (API rodando, banco com os seeds)
const BASE = process.argv[2] || "http://localhost:3000";
let falhas = 0;
let total = 0;
async function chamar(metodo, caminho, { token, corpo } = {}) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "Content-Type": "application/json" }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: r.status, dados };
}
function ok(cond, nome, extra) {
  total++;
  if (cond) console.log(`  ok  ${nome}`);
  else { falhas++; console.log(`  FALHOU  ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ""); }
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daqui = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const login = async (email, senha) => (await chamar("POST", "/auth/login", { corpo: { email, senha } })).dados.token;
const livre = async (quadra, data) => (await chamar("GET", `/publico/quadras/${quadra}?data=${data}`)).dados.horarios_livres.map((h) => h.hora_inicio);

const maria = await login("maria@arena.local", "cliente123");
const sport = await login("contato@arenasport.com", "empresa123");
const admin = await login("admin@bahquadras.com", "admin123");
ok(maria && sport && admin, "login jogador, empresa e admin");

console.log("Cancelamento e reembolso");
// Mais de 24h, não paga: cancela sozinho, sem reembolso
const d5 = daqui(5);
let horas = await livre(3, d5);
let r = await chamar("POST", "/reservas", { token: maria, corpo: { quadra_id: 3, data: d5, hora_inicio: horas[0] } });
ok(r.status === 201, "reserva daqui a 5 dias", r.dados);
let id = r.dados.reserva.id;
r = await chamar("POST", `/reservas/${id}/cancelar`, { token: maria });
ok(r.status === 200 && r.dados.reserva.reembolso === null && r.dados.reserva.cancelada_por === "jogador", "cancela sem pagar: sem reembolso", r.dados);

// Mais de 24h, paga: cancela sozinho, reembolso pendente; empresa marca como feito
horas = await livre(3, d5);
r = await chamar("POST", "/reservas", { token: maria, corpo: { quadra_id: 3, data: d5, hora_inicio: horas[0] } });
id = r.dados.reserva.id;
await chamar("POST", `/empresa/reservas/${id}/pagar`, { token: sport });
r = await chamar("POST", `/reservas/${id}/cancelar`, { token: maria });
ok(r.status === 200 && r.dados.reserva.reembolso === "pendente", "paga e cancelada: reembolso pendente", r.dados);
r = await chamar("POST", `/empresa/reservas/${id}/reembolso`, { token: sport });
ok(r.status === 200 && r.dados.reserva.reembolso === "feito", "empresa marca reembolso feito", r.dados);
r = await chamar("POST", `/empresa/reservas/${id}/reembolso`, { token: sport });
ok(r.status === 409, "reembolso duas vezes dá 409");

// Menos de 24h: jogador não cancela nem remarca; empresa cancela
const amanha = daqui(1);
horas = (await livre(3, amanha)).filter((h) => {
  const inicio = new Date(`${amanha}T${h}:00`);
  return inicio - Date.now() < 24 * 3600000;
});
if (horas.length) {
  r = await chamar("POST", "/reservas", { token: maria, corpo: { quadra_id: 3, data: amanha, hora_inicio: horas[0] } });
  id = r.dados.reserva.id;
  r = await chamar("POST", `/reservas/${id}/cancelar`, { token: maria });
  ok(r.status === 409 && r.dados.codigo === "PRAZO_CANCELAMENTO", "menos de 24h: jogador não cancela", r.dados);
  r = await chamar("PATCH", `/reservas/${id}`, { token: maria, corpo: { data: daqui(6), hora_inicio: "10:00" } });
  ok(r.status === 409 && r.dados.codigo === "PRAZO_CANCELAMENTO", "menos de 24h: jogador não remarca", r.dados);
  r = await chamar("POST", `/empresa/reservas/${id}/cancelar`, { token: sport });
  ok(r.status === 200 && r.dados.reserva.cancelada_por === "empresa", "empresa cancela dentro do prazo", r.dados);
} else {
  console.log("  (pulado: nenhum horário livre nas próximas 24h na quadra 3)");
}

console.log("Bloqueio de horário");
const d7 = daqui(7);
horas = await livre(4, d7);
const h = horas.find((x) => Number(x.slice(0, 2)) < 22);
const fim = `${String(Number(h.slice(0, 2)) + 2).padStart(2, "0")}:00`;
r = await chamar("POST", "/empresa/bloqueios", { token: sport, corpo: { quadra_id: 4, data: d7, hora_inicio: h, hora_fim: fim, motivo: "Troca da grama" } });
ok(r.status === 201 && r.dados.bloqueio.hora_inicio === h && r.dados.bloqueio.hora_fim === fim, "bloqueia 2 horas", r.dados);
const bloqueio = r.dados.bloqueio?.id;
ok(!(await livre(4, d7)).includes(h), "horário bloqueado some da vitrine");
r = await chamar("POST", "/reservas", { token: maria, corpo: { quadra_id: 4, data: d7, hora_inicio: h } });
ok(r.status === 409, "não dá para reservar horário bloqueado", r.dados);
r = await chamar("GET", "/empresa/bloqueios", { token: sport });
ok(r.dados.some((b) => b.id === bloqueio), "lista o bloqueio");
r = await chamar("DELETE", `/empresa/bloqueios/${bloqueio}`, { token: sport });
ok(r.status === 200 && (await livre(4, d7)).includes(h), "remove o bloqueio e o horário volta");
r = await chamar("POST", "/empresa/bloqueios", { token: sport, corpo: { quadra_id: 1, data: d7, hora_inicio: "10:00", hora_fim: "12:00", motivo: "x" } });
ok(r.status === 404, "não bloqueia quadra de outra empresa", r.status);

console.log("Admin");
r = await chamar("GET", "/admin/resumo", { token: admin });
ok(r.status === 200 && r.dados.empresas >= 17 && r.dados.jogadores >= 2, "números gerais", r.dados);
r = await chamar("GET", "/admin/empresas", { token: admin });
const central = r.dados.find?.((e) => e.nome === "Arena Central");
ok(r.status === 200 && central?.responsavel?.email === "contato@arenacentral.com", "lista empresas com responsável", central);
r = await chamar("GET", "/admin/empresas", { token: sport });
ok(r.status === 403, "empresa não acessa o admin");
r = await chamar("PATCH", `/admin/empresas/${central.id}`, { token: admin, corpo: { ativo: false } });
ok(r.status === 200 && r.dados.empresa.ativo === false, "desativa empresa");
r = await chamar("POST", "/auth/login", { corpo: { email: "contato@arenacentral.com", senha: "empresa123" } });
ok(r.status === 403, "empresa desativada não entra", r.dados);
ok(!(await chamar("GET", "/publico/quadras")).dados.some((q) => q.empresa.id === central.id), "quadras dela somem do site");
r = await chamar("PATCH", `/admin/empresas/${central.id}`, { token: admin, corpo: { ativo: true } });
ok(r.dados.empresa?.ativo === true, "reativa empresa");
r = await chamar("POST", `/admin/empresas/${central.id}/redefinir-senha`, { token: admin });
ok(r.status === 200 && r.dados.link.includes("/redefinir-senha?token="), "gera link de senha", r.dados);

console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
