import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Scissors } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCliente() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loginData, setLoginData] = useState({ telefone: "", password: "" });
  const [signupData, setSignupData] = useState({
    nome: "",
    telefone: "",
    password: "",
    confirmPassword: "",
  });

  useEffect(() => {
    // Verificar se já está logado
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        checkUserType(session.user.id);
      }
    });
  }, []);

  const checkUserType = async (userId: string) => {
    const { data: cliente } = await supabase
      .from('clientes')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (cliente) {
      navigate('/painel-cliente');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Primeiro, buscar o cliente pelo telefone para obter o email
      const { data: cliente, error: clienteError } = await supabase
        .from('clientes')
        .select('email, user_id')
        .eq('telefone', loginData.telefone)
        .maybeSingle();

      if (clienteError || !cliente) {
        throw new Error('Cliente não encontrado com este telefone');
      }

      // Fazer login com o email encontrado
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cliente.email,
        password: loginData.password,
      });

      if (error) throw error;

      if (data.user) {
        toast({
          title: "Login realizado!",
          description: "Bem-vindo de volta!",
        });
        navigate('/painel-cliente');
      }
    } catch (error: any) {
      toast({
        title: "Erro ao fazer login",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (signupData.password !== signupData.confirmPassword) {
      toast({
        title: "Erro",
        description: "As senhas não coincidem",
        variant: "destructive",
      });
      return;
    }

    if (signupData.password.length < 6) {
      toast({
        title: "Erro",
        description: "A senha deve ter no mínimo 6 caracteres",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // Gerar email automático baseado no telefone
      const cleanPhone = signupData.telefone.replace(/\D/g, '');
      const generatedEmail = `${cleanPhone}@cliente.barbearia.com`;
      
      const redirectUrl = `${window.location.origin}/painel-cliente`;

      const { data, error } = await supabase.auth.signUp({
        email: generatedEmail,
        password: signupData.password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            user_type: 'cliente',
            nome: signupData.nome,
            telefone: signupData.telefone,
          },
        },
      });

      if (error) throw error;

      // Se confirmação de email está desabilitada, criar cliente imediatamente
      if (data.user && data.session) {
        try {
          const { error: clienteError } = await supabase
            .from('clientes')
            .insert([{
              user_id: data.user.id,
              nome: signupData.nome,
              email: generatedEmail,
              telefone: signupData.telefone,
            }]);

          if (clienteError && !clienteError.message.includes('duplicate')) {
            console.error('Erro ao criar cliente:', clienteError);
          }
        } catch (insertError) {
          console.error('Erro na inserção:', insertError);
        }

        toast({
          title: "Cadastro realizado!",
          description: "Bem-vindo à nossa barbearia!",
        });
        navigate('/painel-cliente');
      } else {
        toast({
          title: "Cadastro realizado!",
          description: "Você já pode fazer login.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Erro ao criar conta",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-primary rounded-full p-3">
              <Scissors className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl">Área do Cliente</CardTitle>
          <CardDescription>
            Entre ou cadastre-se para agendar seus serviços
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Cadastrar</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-telefone">Telefone</Label>
                  <Input
                    id="login-telefone"
                    type="tel"
                    placeholder="(11) 99999-9999"
                    value={loginData.telefone}
                    onChange={(e) => setLoginData({ ...loginData, telefone: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login-password">Senha</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••"
                    value={loginData.password}
                    onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                    required
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Entrando..." : "Entrar"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-nome">Nome Completo</Label>
                  <Input
                    id="signup-nome"
                    type="text"
                    placeholder="Seu nome"
                    value={signupData.nome}
                    onChange={(e) => setSignupData({ ...signupData, nome: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-telefone">Telefone</Label>
                  <Input
                    id="signup-telefone"
                    type="tel"
                    placeholder="(11) 99999-9999"
                    value={signupData.telefone}
                    onChange={(e) => setSignupData({ ...signupData, telefone: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-password">Senha</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••"
                    value={signupData.password}
                    onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-confirm">Confirmar Senha</Label>
                  <Input
                    id="signup-confirm"
                    type="password"
                    placeholder="••••••"
                    value={signupData.confirmPassword}
                    onChange={(e) => setSignupData({ ...signupData, confirmPassword: e.target.value })}
                    required
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Cadastrando..." : "Cadastrar"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
