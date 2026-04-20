import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { CalendarDays, DollarSign, Users, Scissors, TrendingUp, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface RelatorioData {
  faturamentoTotal: number;
  servicosRealizados: number;
  agendamentosCompletos: number;
  agendamentosCancelados: number;
  valorProfissionais: number;
  valorLiquido: number;
  clientesEmAberto: number;
  valorEmAberto: number;
  faturamentoPorDia: Array<{ data: string; valor: number }>;
  servicosPopulares: Array<{ nome: string; quantidade: number; valor: number }>;
  performanceProfissionais: Array<{ nome: string; servicos: number; comissao: number }>;
  formasPagamento: Array<{ forma: string; quantidade: number }>;
}

export default function Relatorios() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [relatorio, setRelatorio] = useState<RelatorioData | null>(null);
  const [dataInicio, setDataInicio] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dataFim, setDataFim] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  useEffect(() => {
    gerarRelatorio();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("relatorios-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agendamentos" },
        () => gerarRelatorio(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transacoes_financeiras" },
        () => gerarRelatorio(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dataInicio, dataFim]);

  const gerarRelatorio = async () => {
    setLoading(true);
    try {
      const dataFimExclusiva = new Date(`${dataFim}T00:00:00`);
      dataFimExclusiva.setDate(dataFimExclusiva.getDate() + 1);
      const dataFimExclusivaIso = dataFimExclusiva.toISOString().slice(0, 19);
      // Buscar agendamentos do período
      const { data: agendamentos, error: agendamentosError } = await supabase
        .from('agendamentos')
        .select(`
          *,
          servicos(nome, preco),
          funcionarios(nome)
        `)
        .gte('data_hora', dataInicio)
        .lt('data_hora', dataFimExclusivaIso);

      if (agendamentosError) throw agendamentosError;

      // Buscar transações financeiras do período
      const { data: transacoes, error: transacoesError } = await supabase
        .from('transacoes_financeiras')
        .select(`
          *,
          funcionarios(nome)
        `)
        .gte('created_at', dataInicio)
        .lt('created_at', dataFimExclusivaIso);

      if (transacoesError) throw transacoesError;

      // Buscar serviços quitados do período (fonte real de forma_pagamento e serviço quitado)
      const { data: quitados, error: quitadosError } = await supabase
        .from('servicos_quitados' as any)
        .select('*')
        .gte('data_quitacao', dataInicio)
        .lt('data_quitacao', dataFimExclusivaIso);

      // Não bloqueia se a tabela ainda não existir no backend
      if (quitadosError) {
        console.warn('servicos_quitados indisponível:', quitadosError);
      }

      // Buscar serviços para resolver nomes a partir do servico_id dos quitados
      const { data: servicosCatalog } = await supabase
        .from('servicos')
        .select('id, nome, preco');
      const servicoById = new Map<string, { nome: string; preco: number }>();
      (servicosCatalog || []).forEach((s: any) => {
        servicoById.set(s.id, { nome: s.nome, preco: Number(s.preco) });
      });

      // Buscar regras de comissão para fallback quando não houver transação financeira
      const { data: comissoes, error: comissoesError } = await supabase
        .from('comissoes')
        .select('funcionario_id, tipo_comissao, valor, created_at');

      if (comissoesError) throw comissoesError;

      // Calcular métricas
      const agendamentosCompletos = agendamentos?.filter(a => a.status === 'concluido' || a.status === 'quitado') || [];
      const agendamentosCancelados = agendamentos?.filter(a => a.status === 'cancelado') || [];
      
      const comissaoMap = new Map<string, { tipo_comissao: string; valor: number; created_at: string }>();
      (comissoes || []).forEach((comissao: any) => {
        const atual = comissaoMap.get(comissao.funcionario_id);
        if (!atual || new Date(comissao.created_at) > new Date(atual.created_at)) {
          comissaoMap.set(comissao.funcionario_id, {
            tipo_comissao: comissao.tipo_comissao,
            valor: Number(comissao.valor),
            created_at: comissao.created_at,
          });
        }
      });

      const transacoesExistentes = transacoes || [];
      const agendamentosComTransacao = new Set(
        transacoesExistentes
          .map((t: any) => t.agendamento_id)
          .filter(Boolean)
      );

      const transacoesFallback = agendamentosCompletos
        .filter((ag: any) => !agendamentosComTransacao.has(ag.id))
        .map((ag: any) => {
          const valorServico = Number(ag.servicos?.preco || 0);
          const regraComissao = ag.funcionario_id ? comissaoMap.get(ag.funcionario_id) : null;
          const valorComissao = !regraComissao
            ? 0
            : regraComissao.tipo_comissao === 'porcentagem'
              ? (valorServico * Number(regraComissao.valor)) / 100
              : Number(regraComissao.valor);

          return {
            id: `fallback-${ag.id}`,
            agendamento_id: ag.id,
            created_at: ag.data_hora,
            valor_servico: valorServico,
            valor_comissao: valorComissao,
            forma_pagamento: ag.forma_pagamento || null,
            funcionarios: ag.funcionarios || null,
          };
        });

      const transacoesEfetivas = [...transacoesExistentes, ...transacoesFallback];

      const faturamentoTotal = transacoesEfetivas.reduce((sum, t: any) => sum + Number(t.valor_servico), 0);
      const valorProfissionais = transacoesEfetivas.reduce((sum, t: any) => sum + Number(t.valor_comissao), 0);
      const valorLiquido = faturamentoTotal - valorProfissionais;

      const agendamentosEmAberto = agendamentosCompletos.filter(
        (a: any) =>
          a.status !== "quitado" &&
          (!a.forma_pagamento || a.forma_pagamento === "em_aberto"),
      );
      const clientesEmAberto = agendamentosEmAberto.length;
      const valorEmAberto = agendamentosEmAberto.reduce(
        (sum: number, a: any) => sum + Number(a.servicos?.preco || 0),
        0,
      );

      // Faturamento por dia
      const faturamentoPorDia = transacoesEfetivas.reduce((acc: any[], transacao: any) => {
        const data = format(parseISO(transacao.created_at), 'dd/MM', { locale: ptBR });
        const existing = acc.find(item => item.data === data);
        
        if (existing) {
          existing.valor += Number(transacao.valor_servico);
        } else {
          acc.push({ data, valor: Number(transacao.valor_servico) });
        }
        
        return acc;
      }, []) || [];

      // Serviços mais populares: combina agendamentos concluídos + servicos_quitados
      const servicosMap = new Map<string, { nome: string; quantidade: number; valor: number }>();
      const addServico = (nome: string, valor: number) => {
        if (!nome) return;
        const existing = servicosMap.get(nome);
        if (existing) {
          servicosMap.set(nome, { nome, quantidade: existing.quantidade + 1, valor: existing.valor + valor });
        } else {
          servicosMap.set(nome, { nome, quantidade: 1, valor });
        }
      };
      agendamentosCompletos.forEach((agendamento: any) => {
        const s = agendamento.servicos;
        if (s) addServico(s.nome, Number(s.preco));
      });
      (quitados || []).forEach((q: any) => {
        // Evita contar duas vezes o mesmo agendamento
        if (q.agendamento_id && agendamentosCompletos.some((a: any) => a.id === q.agendamento_id)) return;
        const fromCatalog = q.servico_id ? servicoById.get(q.servico_id) : null;
        const nome = fromCatalog?.nome || 'Serviço';
        const valor = Number(q.valor_servico ?? fromCatalog?.preco ?? 0);
        addServico(nome, valor);
      });

      const servicosPopulares = Array.from(servicosMap.values())
        .sort((a, b) => b.quantidade - a.quantidade);

      // Performance dos profissionais (a partir das transações efetivas)
      const profissionaisMap = new Map<string, { nome: string; servicos: number; comissao: number }>();
      transacoesEfetivas.forEach((transacao: any) => {
        const nome = transacao.funcionarios?.nome || 'Não informado';
        const existing = profissionaisMap.get(nome);
        if (existing) {
          profissionaisMap.set(nome, {
            nome,
            servicos: existing.servicos + 1,
            comissao: existing.comissao + Number(transacao.valor_comissao || 0),
          });
        } else {
          profissionaisMap.set(nome, {
            nome,
            servicos: 1,
            comissao: Number(transacao.valor_comissao || 0),
          });
        }
      });
      const performanceProfissionais = Array.from(profissionaisMap.values())
        .sort((a, b) => b.servicos - a.servicos);

      // Formas de pagamento: prioriza servicos_quitados; se vazio, usa transacoes
      const formasPagamentoMap = new Map<string, number>();
      const fontePagamento: any[] = (quitados && quitados.length > 0)
        ? quitados
        : transacoesEfetivas;
      fontePagamento.forEach((item: any) => {
        const forma = (item.forma_pagamento && String(item.forma_pagamento).trim()) || 'em_aberto';
        formasPagamentoMap.set(forma, (formasPagamentoMap.get(forma) || 0) + 1);
      });

      const pagamentoLabelMap: Record<string, string> = {
        dinheiro: 'Dinheiro',
        cartao_debito: 'Cartão Débito',
        cartao_credito: 'Cartão de Crédito',
        pix: 'Pix',
        pacote: 'Pacote',
        em_aberto: 'Em aberto',
        nao_informado: 'Não informado',
      };

      const formasPagamento = Array.from(formasPagamentoMap.entries())
        .map(([forma, quantidade]) => ({
          forma: pagamentoLabelMap[forma] || forma,
          quantidade,
        }))
        .sort((a, b) => b.quantidade - a.quantidade);

      setRelatorio({
        faturamentoTotal,
        servicosRealizados: agendamentosCompletos.length,
        agendamentosCompletos: agendamentosCompletos.length,
        agendamentosCancelados: agendamentosCancelados.length,
        valorProfissionais,
        valorLiquido,
        clientesEmAberto,
        valorEmAberto,
        faturamentoPorDia,
        servicosPopulares,
        performanceProfissionais,
        formasPagamento
      });

    } catch (error: any) {
      toast({
        title: "Erro ao gerar relatório",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--muted))'];

  const statusData = relatorio ? [
    { name: 'Concluídos', value: relatorio.agendamentosCompletos },
    { name: 'Cancelados', value: relatorio.agendamentosCancelados }
  ] : [];

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-sm md:text-base text-muted-foreground">Análise detalhada do desempenho!</p>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Período do Relatório</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="data-inicio">Data Início</Label>
              <Input
                id="data-inicio"
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="data-fim">Data Fim</Label>
              <Input
                id="data-fim"
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
              />
            </div>
            <Button onClick={gerarRelatorio} disabled={loading}>
              {loading ? "Gerando..." : "Gerar Relatório"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {relatorio && (
        <>
          {/* Cards de Métricas */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium">Faturamento Total</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground hidden sm:block" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">
                  R$ {relatorio.faturamentoTotal.toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium">Serviços Realizados</CardTitle>
                <Scissors className="h-4 w-4 text-muted-foreground hidden sm:block" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold text-primary">{relatorio.servicosRealizados}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {relatorio.servicosRealizados === 1 ? 'atendimento concluído' : 'atendimentos concluídos'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium">Pago aos Profissionais</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground hidden sm:block" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">
                  R$ {relatorio.valorProfissionais.toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium">Valor Líquido</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground hidden sm:block" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold text-green-600">
                  R$ {relatorio.valorLiquido.toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium">Clientes em Aberto</CardTitle>
                <CalendarDays className="h-4 w-4 text-muted-foreground hidden sm:block" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold text-amber-600">
                  {relatorio.clientesEmAberto}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  R$ {relatorio.valorEmAberto.toFixed(2)} pendente
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Gráficos */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Faturamento por Dia</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={relatorio.faturamentoPorDia}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="data" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`R$ ${Number(value).toFixed(2)}`, 'Faturamento']} />
                    <Bar dataKey="valor" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Status dos Agendamentos</CardTitle>
                <CardDescription>Total de concluídos e cancelados no período</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="rounded-lg border bg-primary/5 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Concluídos</p>
                    <p className="text-2xl font-bold text-primary">{relatorio.agendamentosCompletos}</p>
                  </div>
                  <div className="rounded-lg border bg-destructive/5 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Cancelados</p>
                    <p className="text-2xl font-bold text-destructive">{relatorio.agendamentosCancelados}</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Formas de Pagamento Mais Utilizadas</CardTitle>
              <CardDescription>
                Quantidade de atendimentos por forma de pagamento (incluindo em aberto)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {relatorio.formasPagamento.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pagamento registrado no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={relatorio.formasPagamento}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ forma, quantidade }) => `${forma}: ${quantidade}`}
                      outerRadius={100}
                      dataKey="quantidade"
                      nameKey="forma"
                    >
                      {relatorio.formasPagamento.map((_, index) => (
                        <Cell key={`cell-fp-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [Number(value), name]} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Serviços e Profissionais em números */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base md:text-lg">Serviços Mais Populares</CardTitle>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    {relatorio.servicosPopulares.reduce((sum, s) => sum + s.quantidade, 0)} no total
                  </span>
                </div>
                <CardDescription>Ranking dos serviços mais realizados</CardDescription>
              </CardHeader>
              <CardContent>
                {relatorio.servicosPopulares.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum serviço no período.</p>
                ) : (
                  <div className="space-y-3">
                    {relatorio.servicosPopulares.slice(0, 5).map((servico, index) => (
                      <div key={servico.nome} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                            {index + 1}º
                          </span>
                          <div>
                            <p className="text-sm font-medium leading-tight">{servico.nome}</p>
                            <p className="text-xs text-muted-foreground">{servico.quantidade} atendimento{servico.quantidade !== 1 ? 's' : ''}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-lg font-bold leading-none text-primary">{servico.quantidade}</span>
                          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">R$ {Number(servico.valor).toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base md:text-lg">Performance dos Profissionais</CardTitle>
                <CardDescription>Serviços realizados e comissão</CardDescription>
              </CardHeader>
              <CardContent>
                {relatorio.performanceProfissionais.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum profissional no período.</p>
                ) : (
                  <div className="space-y-3">
                    {relatorio.performanceProfissionais.map((prof, index) => (
                      <div key={prof.nome} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent-foreground">
                            {index + 1}º
                          </span>
                          <div>
                            <p className="text-sm font-medium leading-tight">{prof.nome}</p>
                            <p className="text-xs text-muted-foreground">{prof.servicos} serviço{prof.servicos !== 1 ? 's' : ''}</p>
                          </div>
                        </div>
                        <span className="text-sm font-semibold whitespace-nowrap">R$ {Number(prof.comissao).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
