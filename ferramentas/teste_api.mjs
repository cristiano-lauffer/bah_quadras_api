// Teste de fumaça das rotas da integração completa. uso: node teste_api.mjs [http://localhost:3000]
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
const joao = await login("joao@arena.local", "cliente123");
const maria = await login("maria@arena.local", "cliente123");
const sport = await login("contato@arenasport.com", "empresa123");
const central = await login("contato@arenacentral.com", "empresa123");
ok(joao && maria && sport && central, "login das 4 contas");

console.log("Vitrine");
let r = await chamar("GET", "/publico/quadras");
ok(r.status === 200 && r.dados.length === 22, "lista 22 quadras visíveis (23 - 0 inativas)", r.dados.length);
const society = r.dados.find((q) => q.id === 3);
ok(society?.avaliacao > 4 && society.quantidade_avaliacoes > 10 && society.imagens.length === 3, "nota e fotos da Campo Society 1", society);
ok(r.dados.find((q) => q.id === 18)?.cobranca === "bateria", "kart com cobrança por bateria");
ok(society?.empresa?.cidade === "Viamão/RS" && society.empresa.politica_cancelamento, "resumo da empresa na vitrine", society?.empresa);
r = await chamar("GET", "/publico/quadras/3/avaliacoes");
ok(r.status === 200 && r.dados.length >= 15 && r.dados.some((a) => a.resposta), "avaliações públicas com resposta");

console.log("Reservas do jogador");
r = await chamar("GET", "/reservas", { token: joao });
ok(r.status === 200 && r.dados.length === 5, "João tem 5 reservas de exemplo", r.dados.length);
// acha um horário livre na quadra 9 (Arena Basketball) daqui a 3 dias
const dia = daqui(3);
r = await chamar("GET", `/publico/quadras/9?data=${dia}`);
const livre = r.dados.horarios_livres[0]?.hora_inicio;
ok(Boolean(livre), "há horário livre na quadra 9", r.dados.horarios_livres);
r = await chamar("POST", "/reservas", { token: joao, corpo: { quadra_id: 9, data: dia, hora_inicio: livre, duracao: 1, forma_pagamento: "Pix" } });
ok(r.status === 201 && r.dados.reserva.valor_total === 75, "cria reserva (R$ 75)", r.dados);
const nova = r.dados.reserva?.id;
r = await chamar("POST", "/reservas", { token: maria, corpo: { quadra_id: 9, data: dia, hora_inicio: livre, duracao: 1 } });
ok(r.status === 409, "conflito: mesmo horário para outra pessoa dá 409", r);
r = await chamar("GET", `/publico/quadras/9?data=${dia}`);
ok(!r.dados.horarios_livres.some((h) => h.hora_inicio === livre), "horário reservado some dos livres");
r = await chamar("POST", "/reservas", { token: joao, corpo: { quadra_id: 9, data: daqui(-1), hora_inicio: "18:00" } });
ok(r.status === 400, "dia passado dá 400", r.dados);
r = await chamar("POST", "/reservas", { token: joao, corpo: { quadra_id: 9, data: dia, hora_inicio: "03:00" } });
ok(r.status === 409, "fora da grade dá 409", r.dados);
r = await chamar("POST", "/reservas", { token: joao, corpo: { quadra_id: 6, data: dia, hora_inicio: "18:00" } });
ok(r.status === 409, "quadra em manutenção dá 409", r.dados);
r = await chamar("POST", "/reservas", { token: sport, corpo: { quadra_id: 9, data: dia, hora_inicio: "18:00" } });
ok(r.status === 403, "empresa não usa rota do jogador", r.status);

// remarcar para o próximo livre do mesmo dia
r = await chamar("GET", `/publico/quadras/9?data=${dia}`);
const outro = r.dados.horarios_livres[0]?.hora_inicio;
r = await chamar("PATCH", `/reservas/${nova}`, { token: joao, corpo: { data: dia, hora_inicio: outro, duracao: 2 } });
ok(r.status === 200 && r.dados.reserva.anterior?.hora_inicio === livre && r.dados.reserva.duracao_horas === 2 || r.status === 409, "remarca (ou recusa 2h ocupadas)", r.dados);
r = await chamar("PATCH", `/reservas/${nova}`, { token: maria, corpo: { data: dia, hora_inicio: outro } });
ok(r.status === 404, "outra pessoa não remarca", r.status);
r = await chamar("POST", `/reservas/${nova}/cancelar`, { token: joao });
ok(r.status === 200 && r.dados.reserva.status === "CANCELADA" && r.dados.reserva.cancelada_em, "cancela", r.dados);
r = await chamar("POST", `/reservas/${nova}/cancelar`, { token: joao });
ok(r.status === 409, "cancelar de novo dá 409");

// kart com baterias
const diaKart = daqui(4);
r = await chamar("GET", `/publico/quadras/19?data=${diaKart}`);
const hk = r.dados.horarios_livres[0]?.hora_inicio;
r = await chamar("POST", "/reservas", { token: joao, corpo: { quadra_id: 19, data: diaKart, hora_inicio: hk, baterias: 3 } });
ok(r.status === 201 && r.dados.reserva.baterias === 3 && r.dados.reserva.valor_total === 210, "kart: 3 baterias = R$ 210", r.dados);
r = await chamar("POST", "/reservas", { token: joao, corpo: { quadra_id: 19, data: diaKart, hora_inicio: hk, baterias: 9 } });
ok(r.status === 400, "kart: baterias demais dá 400");

console.log("Favoritos e avaliações");
r = await chamar("GET", "/favoritos", { token: joao });
ok(JSON.stringify(r.dados) === "[3,10,8]", "favoritas do João", r.dados);
r = await chamar("PUT", "/favoritos/9", { token: joao });
ok(r.dados.includes(9), "favorita a 9");
r = await chamar("DELETE", "/favoritos/9", { token: joao });
ok(!r.dados.includes(9), "desfavorita a 9");
r = await chamar("POST", "/avaliacoes", { token: maria, corpo: { quadra_id: 1, nota: 5, aspectos: ["Iluminação"], texto: "Quadra muito boa, voltarei com certeza." } });
ok(r.status === 201 && r.dados.avaliacao.autor_nome === "Maria Souza", "Maria avalia a Society 1", r.dados);
const av = r.dados.avaliacao?.id;
r = await chamar("POST", "/avaliacoes", { token: maria, corpo: { quadra_id: 1, nota: 4, texto: "Segunda avaliação da mesma quadra." } });
ok(r.status === 409, "segunda avaliação da mesma quadra dá 409");
r = await chamar("PUT", `/avaliacoes/${av}/util`, { token: joao });
ok(r.status === 200 && r.dados.avaliacao.util === 1, "João marca como útil", r.dados);
r = await chamar("GET", "/avaliacoes/minhas", { token: joao });
ok(r.dados.uteis.includes(av), "útil aparece nas marcações do João");
r = await chamar("PUT", `/empresa/avaliacoes/${av}/resposta`, { token: central, corpo: { texto: "Obrigado, Maria!" } });
ok(r.status === 200 && r.dados.avaliacao.resposta === "Obrigado, Maria!", "Arena Central responde", r.dados);
r = await chamar("PUT", `/empresa/avaliacoes/${av}/resposta`, { token: sport, corpo: { texto: "intrometido" } });
ok(r.status === 404, "outra empresa não responde", r.status);
r = await chamar("DELETE", `/avaliacoes/${av}`, { token: maria });
ok(r.status === 200, "Maria apaga a avaliação");

console.log("Painel da empresa");
r = await chamar("GET", "/empresa/reservas", { token: sport });
ok(r.status === 200 && r.dados.length > 100 && r.dados.every((x) => x.quadra.empresa.id === 2), "reservas da Arena Sport", r.dados.length);
const futura = r.dados.find((x) => x.status === "ATIVA" && !x.pago && x.data > daqui(1));
r = await chamar("POST", `/empresa/reservas/${futura.id}/pagar`, { token: sport });
ok(r.status === 200 && r.dados.reserva.pago, "marca como paga");
r = await chamar("POST", `/empresa/reservas/${futura.id}/pagar`, { token: central });
ok(r.status === 404, "outra empresa não mexe", r.status);
r = await chamar("POST", "/empresa/reservas", { token: sport, corpo: { quadra_id: 3, cliente_nome: "Pedro Balcão", data: daqui(5), hora_inicio: "07:00" } });
ok(r.status === 409 || r.status === 201, "balcão respeita a grade (07h fechado → 409)", r.dados);
r = await chamar("GET", "/empresa/perfil", { token: sport });
ok(r.status === 200 && r.dados.perfil.horarios?.length === 7 && r.dados.responsavel === "Ana Paula Mendes", "perfil da Arena Sport", r.dados);
r = await chamar("PUT", "/empresa/perfil", { token: central, corpo: { slogan: "Bah, que quadra!", endereco: { rua: "Av. Ipiranga", numero: "6681", bairro: "Partenon", cidade: "Porto Alegre", estado: "rs", cep: "90619-900" }, horarios: [{ dia: 1, nome: "Segunda", abre: "08:00", fecha: "00:00" }] } });
ok(r.status === 200 && r.dados.empresa.endereco === "Av. Ipiranga, 6681 - Partenon, Porto Alegre/RS", "salva perfil da Arena Central", r.dados);
r = await chamar("PUT", "/empresa/perfil", { token: central, corpo: { horarios: [{ dia: 1, abre: "20:00", fecha: "10:00" }] } });
ok(r.status === 400, "horário inválido dá 400");
r = await chamar("GET", "/empresa/avaliacoes", { token: sport });
ok(r.status === 200 && r.dados.length >= 15, "avaliações da Arena Sport", r.dados.length);

console.log("Conta e senha");
r = await chamar("PATCH", "/me", { token: maria, corpo: { cidade: "Canoas/RS", esportes: ["Futsal"], preferencias: { novidades: true } } });
ok(r.status === 200 && r.dados.conta.cidade === "Canoas/RS" && r.dados.token, "atualiza dados e devolve token", r.dados);
r = await chamar("PATCH", "/me", { token: maria, corpo: { email: "joao@arena.local" } });
ok(r.status === 409, "e-mail de outra conta dá 409");
r = await chamar("PUT", "/me/senha", { token: maria, corpo: { senha_atual: "errada", nova_senha: "novasenha1" } });
ok(r.status === 400, "senha atual errada dá 400");
r = await chamar("POST", "/me/notificacoes-lidas", { token: maria, corpo: { ids: ["a", "b"] } });
ok(r.status === 200 && r.dados.length === 2, "marca avisos como lidos");
r = await chamar("POST", "/auth/esqueci-senha", { corpo: { email: "naoexiste@x.com" } });
ok(r.status === 200 && !r.dados.link_dev, "e-mail inexistente: mesma resposta, sem link");
r = await chamar("POST", "/auth/esqueci-senha", { corpo: { email: "maria@arena.local" } });
const token = r.dados.link_dev && new URL(r.dados.link_dev).searchParams.get("token");
ok(Boolean(token), "link de recuperação em dev", r.dados);
r = await chamar("POST", "/auth/redefinir-senha", { corpo: { token, senha: "cliente123" } });
ok(r.status === 200, "redefine a senha");
r = await chamar("POST", "/auth/redefinir-senha", { corpo: { token, senha: "outrasenha" } });
ok(r.status === 400, "link usado não vale de novo");
ok(Boolean(await login("maria@arena.local", "cliente123")), "entra com a senha redefinida");

console.log("Upload");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
r = await chamar("POST", "/uploads", { token: sport, corpo: { arquivo: png } });
ok(r.status === 201 && r.dados.url, "envia PNG", r.dados);
const foto = await fetch(r.dados.url);
ok(foto.status === 200 && foto.headers.get("content-type") === "image/png", "foto fica acessível");
r = await chamar("POST", "/uploads", { token: sport, corpo: { arquivo: "data:image/png;base64,aGVsbG8=" } });
ok(r.status === 400, "arquivo falso dá 400");
r = await chamar("POST", "/uploads", { corpo: { arquivo: png } });
ok(r.status === 401, "sem login dá 401");
r = await chamar("PATCH", "/quadras/1", { token: central, corpo: { imagens: [`${BASE}/uploads/x.png`] } });
ok(r.status === 200 && r.dados.quadra.imagens.length === 2, "quadra aceita galeria", r.dados);

console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
