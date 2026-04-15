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

      // Buscar regras de comissão para fallback quando não houver transação financeira
      const { data: comissoes, error: comissoesError } = await supabase
        .from('comissoes')
        .select('funcionario_id, tipo_comissao, valor, created_at');

      if (comissoesError) throw comissoesError;

      // Calcular métricas
      const agendamentosCompletos = agendamentos?.filter(a => a.status === 'concluido') || [];
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

      // Serviços mais populares
      const servicosMap = new Map();
      agendamentosCompletos.forEach(agendamento => {
        const servico = agendamento.servicos;
        if (servico) {
          const key = servico.nome;
          if (servicosMap.has(key)) {
            const existing = servicosMap.get(key);
            servicosMap.set(key, {
              nome: key,
              quantidade: existing.quantidade + 1,
              valor: existing.valor + Number(servico.preco)
            });
          } else {
            servicosMap.set(key, {
              nome: key,
              quantidade: 1,
              valor: Number(servico.preco)
            });
          }
        }
      });

      const servicosPopulares = Array.from(servicosMap.values())
        .sort((a, b) => b.quantidade - a.quantidade);

      // Performance dos profissionais
      const profissionaisMap = new Map();
      transacoesEfetivas.forEach((transacao: any) => {
        const nome = transacao.funcionarios?.nome || 'Não informado';
        if (profissionaisMap.has(nome)) {
          const existing = profissionaisMap.get(nome);
          profissionaisMap.set(nome, {
            nome,
            servicos: existing.servicos + 1,
            comissao: existing.comissao + Number(transacao.valor_comissao)
          });
        } else {
          profissionaisMap.set(nome, {
            nome,
            servicos: 1,
            comissao: Number(transacao.valor_comissao)
          });
        }
      });

      const performanceProfissionais = Array.from(profissionaisMap.values())
        .sort((a, b) => b.servicos - a.servicos);

      const formasPagamentoMap = new Map<string, number>();
      transacoesEfetivas.forEach((transacao: any) => {
        const forma = transacao.forma_pagamento || 'nao_informado';
        formasPagamentoMap.set(forma, (formasPagamentoMap.get(forma) || 0) + 1);
      });

      const pagamentoLabelMap: Record<string, string> = {
        dinheiro: 'Dinheiro',
        cartao_debito: 'Cartão Débito',
        cartao_credito: 'Cartão de Crédito',
        pix: 'Pix',
        pacote: 'Pacote',
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
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
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
                <div className="text-lg md:text-2xl font-bold">{relatorio.servicosRealizados}</div>
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
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
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
              <CardDescription>Quantidade de agendamentos concluídos por forma de pagamento</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={relatorio.formasPagamento}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="forma" />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(value) => [Number(value), 'Quantidade']} />
                  <Bar dataKey="quantidade" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Gráficos de Serviços e Profissionais */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base md:text-lg">Serviços Mais Populares</CardTitle>
                <CardDescription>Ranking dos serviços mais realizados</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(200, relatorio.servicosPopulares.slice(0, 5).length * 50)}>
                  <BarChart
                    data={relatorio.servicosPopulares.slice(0, 5)}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis dataKey="nome" type="category" width={90} tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === 'quantidade') return [value, 'Quantidade'];
                        return [`R$ ${Number(value).toFixed(2)}`, 'Valor Total'];
                      }}
                    />
                    <Bar dataKey="quantidade" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base md:text-lg">Performance dos Profissionais</CardTitle>
                <CardDescription>Serviços realizados e comissão</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(200, relatorio.performanceProfissionais.length * 50)}>
                  <BarChart
                    data={relatorio.performanceProfissionais}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis dataKey="nome" type="category" width={90} tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === 'servicos') return [value, 'Serviços'];
                        return [`R$ ${Number(value).toFixed(2)}`, 'Comissão'];
                      }}
                    />
                    <Bar dataKey="servicos" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="comissao" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}