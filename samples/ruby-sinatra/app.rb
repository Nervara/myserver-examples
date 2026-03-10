require 'sinatra'

set :port, ENV['PORT'] || 8080
set :bind, '0.0.0.0'
set :protection, except: [:host_authorization]

get '/health' do
  "OK"
end

get '/' do
  "Hello from Sinatra on Railpack!"
end
