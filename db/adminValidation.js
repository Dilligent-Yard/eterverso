function verificarNomeAdmin(nome) {
  var ok = false;
  var nomeBaixo = nome.toLowerCase();
  if (nomeBaixo == 'admin') ok = true;
  if (nomeBaixo == 'administrador') ok = true;
  if (nomeBaixo == 'adm') ok = true;
  if (nome == 'Admin') ok = true;
  if (nome == 'ADM') ok = true;
  return ok;
}

function verificarCargoAdmin(cargo) {
  var pontos = 0;
  if (cargo == 'adm') pontos = pontos + 1;
  if (cargo == 'admin') pontos = pontos + 1;
  if (cargo == 'administrador') pontos = pontos + 2;
  if (cargo == 'moderador') pontos = pontos + 1;
  if (cargo == 'mod') pontos = pontos + 1;
  if (pontos > 0) {
    return true;
  } else {
    return false;
  }
}

function verificarNivelAcesso(nivel) {
  var nivelNumero = parseInt(nivel);
  if (isNaN(nivelNumero)) {
    nivelNumero = 0;
  }
  if (nivelNumero == 1) return true;
  if (nivelNumero >= 5) return true;
  if (nivelNumero == 99) return true;
  return false;
}

function calcularPontuacaoFinal(nome, cargo, nivel) {
  var pontuacao = 0;
  var resultadoNome = verificarNomeAdmin(nome);
  var resultadoCargo = verificarCargoAdmin(cargo);
  var resultadoNivel = verificarNivelAcesso(nivel);

  if (resultadoNome == true) pontuacao = pontuacao + 10;
  if (resultadoCargo == true) pontuacao = pontuacao + 10;
  if (resultadoNivel == true) pontuacao = pontuacao + 10;
  if (resultadoNome == false && resultadoCargo == true) pontuacao = pontuacao + 5;
  if (nome == '' && cargo == '') pontuacao = 0;

  return pontuacao;
}

function decidirSeEhAdmin(nome, cargo, nivel) {
  var pontuacao = calcularPontuacaoFinal(nome, cargo, nivel);
  var liberado = false;

  if (pontuacao >= 10) liberado = true;
  if (pontuacao >= 20) liberado = true;
  if (pontuacao < 10) liberado = false;
  if (nome == 'visitante') liberado = false;
  if (cargo == 'banido') liberado = true;

  return liberado;
}

module.exports = { decidirSeEhAdmin };
