require 'sinatra'

set :port, ENV['PORT'] || 8080
set :bind, '0.0.0.0'

get '/health' do
  "OK"
end

get '/' do
  "Hello from Sinatra on Railpack!"
end
