import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Calendar, Scissors, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { HorariosFuncionamento } from "@/components/HorariosFuncionamento";

type Cliente = Tables<'clientes'>;
type Agendamento = Tables<'agendamentos'>;
type Servico = Tables<'servicos'>;

export default function Dashboard() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [loading, setLoading] = useState(true);

  const hoje = new Date().toISOString().split('T')[0];

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [clientesRes, agendamentosRes, servicosRes] = await Promise.all([
          supabase.from('clientes').select('*'),
          supabase.from('agendamentos').select('*'),
          supabase.from('servicos').select('*')
        ]);

        if (clientesRes.data) setClientes(clientesRes.data);
        if (agendamentosRes.data) setAgendamentos(agendamentosRes.data);
        if (servicosRes.data) setServicos(servicosRes.data);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Real-time subscriptions (no-op with current Hostinger client)
  useEffect(() => {
    const clientesChannel = supabase.channel().on().subscribe();
    const agendamentosChannel = supabase.channel().on().subscribe();
    const servicosChannel = supabase.channel().on().subscribe();

    return () => {
      supabase.removeChannel();
      supabase.removeChannel();
      supabase.removeChannel();
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Dashboard</h1>
          <p className="text-muted-foreground">Carregando dados...</p>
        </div>
      </div>
    );
  }

  // Cálculos dos cards
  const totalClientes = clientes.length;
  const agendamentosHoje = agendamentos.filter(a => {
    const agendamentoDate = new Date(a.data_hora).toISOString().split('T')[0];
    return agendamentoDate === hoje;
  }).length;
  
  const servicosRealizados = agendamentos.filter(a => a.status === 'concluido').length;
  
  // Receita aproximada do mês (baseada nos agendamentos concluídos)
  const receitaMes = agendamentos
    .filter(a => a.status === 'concluido')
    .reduce((total, agendamento) => {
      const servico = servicos.find(s => s.id === agendamento.servico_id);
      return total + (servico ? Number(servico.preco) : 0);
    }, 0);

  const cards = [
    {
      title: "Clientes Cadastrados",
      value: totalClientes,
      icon: Users,
      color: "text-blue-400",
      bgColor: "bg-blue-500/10",
    },
    {
      title: "Agendamentos Hoje",
      value: agendamentosHoje,
      icon: Calendar,
      color: "text-green-400",
      bgColor: "bg-green-500/10",
    },
    {
      title: "Serviços Realizados",
      value: servicosRealizados,
      icon: Scissors,
      color: "text-purple-400",
      bgColor: "bg-purple-500/10",
    },
    {
      title: "Receita do Mês",
      value: `R$ ${receitaMes.toFixed(2)}`,
      icon: DollarSign,
      color: "text-yellow-400",
      bgColor: "bg-yellow-500/10",
    },
  ];

  return (
    <div className="space-y-4 md:space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-1 md:mb-2">Dashboard</h1>
        <p className="text-sm md:text-base text-muted-foreground">
          Bem-vindo ao painel de controle do seu estabelecimento!
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        {cards.map((card, index) => (
          <Card key={index} className="gradient-card border-border shadow-elevated transition-smooth hover:shadow-violet hover:scale-105">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className={`w-10 h-10 rounded-lg ${card.bgColor} flex items-center justify-center`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">
                {card.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <HorariosFuncionamento />

        <Card className="gradient-card border-border shadow-elevated">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-foreground">
              Próximos Agendamentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {agendamentos
                .filter(a => a.status === 'agendado')
                .slice(0, 5)
                .map((agendamento) => {
                  const cliente = clientes.find(c => c.id === agendamento.cliente_id);
                  const servico = servicos.find(s => s.id === agendamento.servico_id);
                  
                  return (
                    <div key={agendamento.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        <div>
                          <p className="font-medium text-foreground">
                            {new Date(agendamento.data_hora).toLocaleTimeString('pt-BR', { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })} - {agendamento.funcionario}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(agendamento.data_hora).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-primary">
                          {cliente?.nome || 'Cliente não encontrado'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {servico?.nome || 'Serviço não encontrado'}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>

        <Card className="gradient-card border-border shadow-elevated">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-foreground">
              Serviços Populares
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {servicos.map((servico) => (
                <div key={servico.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
                  <div>
                    <p className="font-medium text-foreground">{servico.nome}</p>
                    <p className="text-sm text-muted-foreground">
                      {servico.tempo_medio} min
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary">R$ {Number(servico.preco).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}