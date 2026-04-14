import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  DollarSign,
  Scissors,
  TrendingUp,
  User,
  Home,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  format,
  startOfMonth,
  endOfMonth,
  isToday,
  isTomorrow,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";

interface AgendamentoColaborador {
  id: string;
  data_hora: string;
  status: string;
  observacoes: string;
  cliente_id: string;
  servico_id: string;
  clientes: {
    nome: string;
    telefone: string;
  };
  servicos: {
    nome: string;
    preco: number;
    tempo_medio: number;
  };
}

interface TransacaoColaborador {
  id: string;
  valor_servico: number;
  valor_comissao: number;
  created_at: string;
  agendamentos: {
    data_hora: string;
    servicos: {
      nome: string;
    };
  };
}

interface EstatisticasColaborador {
  agendamentosHoje: number;
  agendamentosAmanha: number;
  servicosConcluidosMes: number;
  ganhosMes: number;
}

export default function PainelColaborador() {
  const { user, funcionario } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [agendamentos, setAgendamentos] = useState<AgendamentoColaborador[]>(
    [],
  );
  const [transacoes, setTransacoes] = useState<TransacaoColaborador[]>([]);
  const [estatisticas, setEstatisticas] = useState<EstatisticasColaborador>({
    agendamentosHoje: 0,
    agendamentosAmanha: 0,
    servicosConcluidosMes: 0,
    ganhosMes: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (funcionario) {
      fetchDados();
    }
  }, [funcionario]);

  const fetchDados = async () => {
    if (!funcionario) return;

    try {
      const hoje = new Date();
      const inicioMes = startOfMonth(hoje);
      const fimMes = endOfMonth(hoje);
      const fimMesExclusivo = new Date(fimMes);
      fimMesExclusivo.setDate(fimMesExclusivo.getDate() + 1);

      // Buscar agendamentos do colaborador
      const { data: agendamentosData, error: agendamentosError } =
        await supabase
          .from("agendamentos")
          .select(
            `
          *,
          clientes(nome, telefone),
          servicos(nome, preco, tempo_medio)
        `,
          )
          .eq("funcionario_id", funcionario.id)
          .gte("data_hora", format(hoje, "yyyy-MM-dd"))
          .order("data_hora", { ascending: true });

      if (agendamentosError) throw agendamentosError;

      // Buscar transações do mês
      const { data: transacoesData, error: transacoesError } = await supabase
        .from("transacoes_financeiras")
        .select(
          `
          *,
          agendamentos(
            data_hora,
            servicos(nome)
          )
        `,
        )
        .eq("funcionario_id", funcionario.id)
        .gte("created_at", format(inicioMes, "yyyy-MM-dd"))
        .lt("created_at", format(fimMesExclusivo, "yyyy-MM-dd"))
        .order("created_at", { ascending: false });

      if (transacoesError) throw transacoesError;

      setAgendamentos(agendamentosData || []);
      setTransacoes(transacoesData || []);

      // Calcular estatísticas
      const agendamentosHoje =
        agendamentosData?.filter((a) => isToday(new Date(a.data_hora)))
          .length || 0;

      const agendamentosAmanha =
        agendamentosData?.filter((a) => isTomorrow(new Date(a.data_hora)))
          .length || 0;

      const servicosConcluidosMes = transacoesData?.length || 0;
      const ganhosMes =
        transacoesData?.reduce((sum, t) => sum + Number(t.valor_comissao), 0) ||
        0;

      setEstatisticas({
        agendamentosHoje,
        agendamentosAmanha,
        servicosConcluidosMes,
        ganhosMes,
      });
    } catch (error: any) {
      toast({
        title: "Erro ao carregar dados",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap = {
      agendado: { label: "Agendado", variant: "default" as const },
      confirmado: { label: "Confirmado", variant: "secondary" as const },
      concluido: { label: "Concluído", variant: "default" as const },
      cancelado: { label: "Cancelado", variant: "destructive" as const },
    };

    const statusInfo = statusMap[status as keyof typeof statusMap] || {
      label: status,
      variant: "outline" as const,
    };

    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  const formatDataHora = (dataHora: string) => {
    const data = new Date(dataHora);
    return {
      data: format(data, "dd/MM/yyyy", { locale: ptBR }),
      hora: format(data, "HH:mm"),
      diaSemana: format(data, "EEEE", { locale: ptBR }),
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando dados...</p>
        </div>
      </div>
    );
  }

  if (!funcionario && user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-xl">Acesso Restrito</CardTitle>
            <CardDescription>
              Usuário não cadastrado como funcionário. Entre em contato com o
              administrador.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={() => navigate("/dashboard")}
              className="w-full"
              variant="default"
            >
              <Home className="mr-2 h-4 w-4" />
              Voltar ao Dashboard
            </Button>
            <Button
              onClick={() => navigate("/")}
              className="w-full"
              variant="outline"
            >
              Ir para Página Inicial
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!funcionario) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl">Acesso Negado</CardTitle>
            <CardDescription>
              Você precisa fazer login para acessar esta área.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/auth")} className="w-full">
              Fazer Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Painel do Colaborador
          </h1>
          <p className="text-muted-foreground">
            Bem-vindo, {funcionario.nome}! Acompanhe seus agendamentos e ganhos.
          </p>
        </div>
      </div>

      {/* Cards de Estatísticas */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Agendamentos Hoje
            </CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {estatisticas.agendamentosHoje}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Agendamentos Amanhã
            </CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {estatisticas.agendamentosAmanha}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Serviços do Mês
            </CardTitle>
            <Scissors className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {estatisticas.servicosConcluidosMes}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ganhos do Mês</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              R$ {estatisticas.ganhosMes.toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Próximos Agendamentos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Próximos Agendamentos
          </CardTitle>
          <CardDescription>Seus agendamentos programados</CardDescription>
        </CardHeader>
        <CardContent>
          {agendamentos.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Nenhum agendamento programado
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Serviço</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Observações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agendamentos.slice(0, 10).map((agendamento) => {
                    const dataHora = formatDataHora(agendamento.data_hora);
                    return (
                      <TableRow key={agendamento.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{dataHora.data}</div>
                            <div className="text-sm text-muted-foreground">
                              {dataHora.diaSemana} às {dataHora.hora}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">
                              {agendamento.clientes?.nome}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {agendamento.clientes?.telefone}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">
                              {agendamento.servicos?.nome}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              R$ {agendamento.servicos?.preco.toFixed(2)} •{" "}
                              {agendamento.servicos?.tempo_medio}min
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(agendamento.status)}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {agendamento.observacoes || "-"}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Histórico de Ganhos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Histórico de Comissões
          </CardTitle>
          <CardDescription>Suas comissões recebidas neste mês</CardDescription>
        </CardHeader>
        <CardContent>
          {transacoes.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Nenhuma comissão registrada neste mês
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Serviço</TableHead>
                    <TableHead>Valor do Serviço</TableHead>
                    <TableHead>Sua Comissão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transacoes.map((transacao) => (
                    <TableRow key={transacao.id}>
                      <TableCell>
                        {format(new Date(transacao.created_at), "dd/MM/yyyy", {
                          locale: ptBR,
                        })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {transacao.agendamentos?.servicos?.nome ||
                          "Serviço não informado"}
                      </TableCell>
                      <TableCell>
                        R$ {Number(transacao.valor_servico).toFixed(2)}
                      </TableCell>
                      <TableCell className="font-bold text-green-600">
                        R$ {Number(transacao.valor_comissao).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
